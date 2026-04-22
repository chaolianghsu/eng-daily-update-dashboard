#!/usr/bin/env node
// scripts/analyze-and-post.mjs — Stage 2+3 of issue routing DAG.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task D2.
//
// Runs after collect-new-issues.mjs. For each open issue in state where the
// content hash has changed since we last posted (or has never been posted):
//   1. Fetch fresh issue detail + notes from GitLab
//   2. Find up to 3 similar closed issues (same primary label) via state DB
//   3. Build LLM context, run Phase 1 routing, run Phase 2 plan (confidence gate)
//   4. Confidential policy: if project path ends with "_confidential" AND
//      allowConfidentialLLM=false → skip LLM, use labels-only fallback
//   5. Decide post type:
//        - No primary_msg_id        → postCard (new thread)
//        - Prior post + hash change → replyInThread (update card)
//        - State transitioned closed → replyInThread (closed summary)
//   6. Save posted_hash + action_token into last_analysis_json; update state.
//   7. On Chat/LLM failure: incrementFailure (state store flips to 'failed'
//      after 5 strikes) and continue to next issue.
//
// Exit codes:
//   0 — success (or another cron lock holder)
//   1 — unexpected error
//   2 — invalid config
//   3 — critical failure (rare; e.g. DB can't be opened)

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { createStateStore } from '../lib/state.mjs';
import { createGitLabClient, GitLabApiError } from '../lib/gitlab-client.mjs';
import { createChatClient, buildAnalysisCard, ChatApiError } from '../lib/chat-client.mjs';
import { buildLLMContext } from '../lib/llm/context-builder.mjs';
import { runPhase1Routing, LLMApiError } from '../lib/llm/phase1-routing.mjs';
import { runPhase2Plan } from '../lib/llm/phase2-plan.mjs';
import { loadLabelRouting, validateConfig, getRepoSuggestions } from '../lib/config.mjs';
import { hashIssueContent } from '../lib/hash.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const PHASE1_CONFIDENCE_GATE = 0.5;
const SIMILAR_ISSUES_LIMIT = 3;
const CONFIDENTIAL_SUFFIX = '_confidential';

// ---- pure helpers -----------------------------------------------------------

/** Extract "group/project" path from a GitLab web_url. */
export function projectPathFromUrl(webUrl) {
  if (!webUrl || typeof webUrl !== 'string') return null;
  try {
    const u = new URL(webUrl);
    // GitLab issue URLs look like: /<group>/<subgroup?>/<project>/-/issues/<iid>
    const parts = u.pathname.split('/-/')[0].split('/').filter(Boolean);
    if (parts.length === 0) return null;
    return parts.join('/');
  } catch {
    return null;
  }
}

/** First non-ignored label from label_config (used as primary routing label). */
export function pickPrimaryLabel(labels, labelConfig) {
  const ignore = new Set(labelConfig?.ignore_for_routing ?? []);
  const known = labelConfig?.labels ?? {};
  for (const l of labels || []) {
    if (ignore.has(l)) continue;
    if (known[l]) return l;
  }
  // fall back to first non-ignored label (even if unknown)
  for (const l of labels || []) {
    if (!ignore.has(l)) return l;
  }
  return null;
}

/**
 * Return true if the primary label of `row.labels` matches `primaryLabel`.
 * Used to filter closed issues for similar-issue context.
 */
export function rowMatchesPrimaryLabel(row, primaryLabel, labelConfig) {
  if (!row?.labels) return false;
  let labels;
  try { labels = JSON.parse(row.labels); } catch { return false; }
  return pickPrimaryLabel(labels, labelConfig) === primaryLabel;
}

/** Build the fallback analysis object used when LLM is skipped for confidential issues. */
export function buildConfidentialFallback({ issue, labelConfig }) {
  const primaryLabel = pickPrimaryLabel(issue.labels || [], labelConfig);
  const suggestion = primaryLabel
    ? getRepoSuggestions(labelConfig, primaryLabel)
    : { isKnownLabel: false };

  let suggestedRepos = [];
  if (suggestion.isKnownLabel) {
    if (Array.isArray(suggestion.primary)) {
      suggestedRepos = [...suggestion.primary];
    } else {
      const primaryGroup = suggestion.primary_group ? [suggestion.primary_group] : [];
      const exceptions = suggestion.known_exceptions ?? [];
      suggestedRepos = [...primaryGroup, ...exceptions];
    }
  }

  return {
    summary: `[Confidential] 跳過 LLM 分析 (allow_confidential_llm=false);以 label 進行最小化路由建議。`,
    suggested_repos: suggestedRepos.slice(0, 3),
    suggested_assignees: [],
    confidence: 0.4,
    plan_draft: null,
    reasoning: 'skipped LLM per confidential policy',
    layer: 'n/a',
    caveats: ['confidential issue — labels-only routing'],
  };
}

/** Construct the card-facing analysis object from phase1 + phase2 output. */
export function mergeAnalysis(phase1, phase2) {
  return {
    summary: phase2?.summary ?? phase1?.reasoning ?? '',
    suggested_repos: phase1?.suggested_repos ?? [],
    suggested_assignees: phase1?.suggested_assignees ?? [],
    confidence: phase1?.confidence ?? 0,
    plan_draft: phase2?.plan_draft ?? null,
    reasoning: phase1?.reasoning ?? '',
    layer: phase1?.layer ?? 'n/a',
    caveats: phase1?.caveats ?? [],
  };
}

/** Decide which post action to take based on row state and issue state. */
export function decidePostType(row, issue) {
  if (!row.primary_msg_id) return 'new';
  if (issue.state === 'closed') return 'closed';
  return 'update';
}

// ---- orchestrator -----------------------------------------------------------

/**
 * @param {object} opts
 * @param {object} opts.stateStore
 * @param {object} opts.gitlabClient
 * @param {object} opts.chatClient
 * @param {object} opts.labelConfig
 * @param {boolean} [opts.allowConfidentialLLM=true]
 * @param {string} opts.spaceId
 * @param {string|null} [opts.confidentialSpaceId=null]
 * @param {Function} [opts.phase1Fn=runPhase1Routing]
 * @param {Function} [opts.phase2Fn=runPhase2Plan]
 * @param {object} [opts.logger=console]
 * @param {() => number} [opts.now]
 * @param {() => string} [opts.generateToken]
 * @param {object} [opts.anthropicClient=null]
 * @returns {Promise<{processed:number, posted_new:number, threaded_updates:number, errors:number, skipped:number}>}
 */
export async function runAnalyzeAndPost({
  stateStore,
  gitlabClient,
  chatClient,
  labelConfig,
  allowConfidentialLLM = true,
  spaceId,
  confidentialSpaceId = null,
  phase1Fn = runPhase1Routing,
  phase2Fn = runPhase2Plan,
  logger = console,
  now = () => Math.floor(Date.now() / 1000),
  generateToken = () => randomBytes(16).toString('hex'),
  anthropicClient = null,
}) {
  let processed = 0;
  let posted_new = 0;
  let threaded_updates = 0;
  let errors = 0;
  let skipped = 0;

  const openRows = stateStore.listByStatus('open');
  const closedRows = stateStore.listByStatus('closed');

  for (const row of openRows) {
    processed += 1;
    const uid = row.issue_uid;

    try {
      // ---- skip-if-already-posted check ------------------------------------
      let storedPostedHash = null;
      if (row.last_analysis_json) {
        try {
          const parsed = JSON.parse(row.last_analysis_json);
          storedPostedHash = parsed.posted_hash ?? null;
        } catch {
          storedPostedHash = null;
        }
      }
      if (row.primary_msg_id && storedPostedHash === row.last_analysis_hash) {
        skipped += 1;
        continue;
      }

      // ---- fetch fresh issue + derive project path -------------------------
      const projectPath = projectPathFromUrl(row.gitlab_url);
      if (!projectPath) {
        logger.warn?.(`[analyze] ${uid}: cannot derive project_path from gitlab_url=${row.gitlab_url}`);
        errors += 1;
        stateStore.incrementFailure(uid);
        continue;
      }

      const [, iidStr] = uid.split(':');
      const iid = Number(iidStr);
      const issue = await gitlabClient.fetchIssue(projectPath, iid);

      // notes are best-effort — ignore failures
      try {
        await gitlabClient.fetchIssueNotes(projectPath, iid);
      } catch (err) {
        logger.warn?.(`[analyze] ${uid}: fetchIssueNotes failed, continuing: ${err.message}`);
      }

      // ---- confidential policy --------------------------------------------
      const isConfidential = projectPath.endsWith(CONFIDENTIAL_SUFFIX);
      const skipLLM = isConfidential && !allowConfidentialLLM;

      let analysis;
      if (skipLLM) {
        analysis = buildConfidentialFallback({ issue, labelConfig });
      } else {
        // ---- build similar-issues context ---------------------------------
        const primaryLabel = pickPrimaryLabel(issue.labels || [], labelConfig);
        const similar = primaryLabel
          ? closedRows
              .filter((r) => rowMatchesPrimaryLabel(r, primaryLabel, labelConfig))
              .slice(0, SIMILAR_ISSUES_LIMIT)
              .map((r) => {
                let lbls = [];
                try { lbls = JSON.parse(r.labels); } catch {}
                return {
                  iid: Number((r.issue_uid || '').split(':')[1] ?? 0),
                  title: '(closed issue)',
                  labels: lbls,
                  assignee: '',
                  closing_excerpt: '',
                };
              })
          : [];

        const ctx = buildLLMContext({
          new_issue: {
            title: issue.title ?? '',
            description: issue.description ?? '',
            labels: issue.labels ?? [],
            id: issue.iid,
            project_path: projectPath,
          },
          similar_issues: similar,
          label_config: labelConfig,
        });

        // ---- run LLM phases ---------------------------------------------
        const phase1Opts = anthropicClient ? { client: anthropicClient } : {};
        const phase1 = await phase1Fn(ctx, phase1Opts);

        let phase2 = null;
        if ((phase1.confidence ?? 0) >= PHASE1_CONFIDENCE_GATE) {
          phase2 = await phase2Fn(ctx, phase1, phase1Opts);
        }

        analysis = mergeAnalysis(phase1, phase2);
      }

      // ---- decide post type + build card -----------------------------------
      const postType = decidePostType(row, issue);
      const actionToken = generateToken();
      const card = buildAnalysisCard({
        issue: {
          uid,
          iid: issue.iid,
          title: issue.title,
          labels: issue.labels,
        },
        analysis,
        actionToken,
      });

      const targetSpace = (isConfidential && confidentialSpaceId) ? confidentialSpaceId : spaceId;

      // ---- post (with per-issue error boundary) ----------------------------
      let postResult;
      try {
        if (postType === 'new') {
          postResult = await chatClient.postCard(targetSpace, card);
        } else if (postType === 'closed' || postType === 'update') {
          postResult = await chatClient.replyInThread(targetSpace, row.thread_id, card);
        }
      } catch (err) {
        if (err instanceof ChatApiError) {
          logger.warn?.(`[analyze] ${uid}: Chat API error (status=${err.status}): ${err.message}`);
          errors += 1;
          stateStore.incrementFailure(uid);
          continue;
        }
        throw err;
      }

      // ---- persist state ---------------------------------------------------
      const ts = now();
      const postedHash = row.last_analysis_hash;
      const storedJson = {
        ...analysis,
        posted_hash: postedHash,
        action_token: actionToken,
      };

      const nextThreadId = postType === 'new'
        ? (postResult?.thread?.name ?? row.thread_id)
        : row.thread_id;
      const nextPrimaryMsgId = postType === 'new'
        ? (postResult?.name ?? row.primary_msg_id)
        : row.primary_msg_id;
      const nextStatus = issue.state === 'closed' ? 'closed' : row.status;

      let labelsArr = [];
      try { labelsArr = JSON.parse(row.labels); } catch {}

      stateStore.upsert({
        issue_uid: uid,
        gitlab_url: row.gitlab_url,
        labels: labelsArr,
        thread_id: nextThreadId,
        primary_msg_id: nextPrimaryMsgId,
        last_analysis_hash: row.last_analysis_hash,
        last_analysis_json: JSON.stringify(storedJson),
        last_posted_at: ts,
        status: nextStatus,
        approval_status: row.approval_status ?? 'pending',
        created_at: row.created_at,
        updated_at: ts,
      });

      if (postType === 'new') {
        posted_new += 1;
      } else {
        threaded_updates += 1;
      }
    } catch (err) {
      if (err instanceof LLMApiError) {
        logger.warn?.(`[analyze] ${uid}: LLM error (${err.code}): ${err.message}`);
        errors += 1;
        stateStore.incrementFailure(uid);
        continue;
      }
      if (err instanceof GitLabApiError) {
        logger.warn?.(`[analyze] ${uid}: GitLab error (status=${err.status}): ${err.message}`);
        errors += 1;
        stateStore.incrementFailure(uid);
        continue;
      }
      logger.error?.(`[analyze] ${uid}: unexpected error: ${err.message}`);
      errors += 1;
      stateStore.incrementFailure(uid);
    }
  }

  logger.log?.(
    `[analyze] run complete: processed=${processed} posted_new=${posted_new} ` +
      `threaded_updates=${threaded_updates} skipped=${skipped} errors=${errors}`,
  );

  return { processed, posted_new, threaded_updates, errors, skipped };
}

// ---- CLI entry point --------------------------------------------------------

async function main() {
  let gitlabCfg, chatCfg, labelConfig;
  try {
    const gitlabConfigPath = process.env.GITLAB_CONFIG || join(REPO_ROOT, 'gitlab-config.json');
    gitlabCfg = JSON.parse(readFileSync(gitlabConfigPath, 'utf8'));

    const chatConfigPath = process.env.CHAT_CONFIG || join(REPO_ROOT, 'chat-config.json');
    chatCfg = JSON.parse(readFileSync(chatConfigPath, 'utf8'));

    const labelConfigPath = process.env.LABEL_CONFIG || join(REPO_ROOT, 'config', 'label-routing.yaml');
    labelConfig = validateConfig(loadLabelRouting(labelConfigPath));
  } catch (err) {
    console.error('[analyze] invalid config:', err.message);
    process.exit(2);
  }

  const dbPath = process.env.STATE_DB || join(REPO_ROOT, 'db', 'issue-routing.sqlite');
  const store = createStateStore(dbPath);

  const lock = store.acquireCronLock();
  if (!lock) {
    console.log('[analyze] another instance holds the cron lock, skipping this run');
    store.close();
    process.exit(0);
  }

  try {
    const gitlabClient = createGitLabClient({
      baseUrl: gitlabCfg.baseUrl,
      token: gitlabCfg.token,
    });
    const chatClient = createChatClient({
      accessToken: chatCfg.accessToken ?? chatCfg.token ?? process.env.CHAT_ACCESS_TOKEN,
    });

    const allowConfidentialLLM = process.env.ALLOW_CONFIDENTIAL_LLM
      ? process.env.ALLOW_CONFIDENTIAL_LLM !== 'false'
      : true;

    await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig,
      allowConfidentialLLM,
      spaceId: chatCfg.spaceId,
      confidentialSpaceId: chatCfg.confidentialSpaceId ?? null,
    });
  } catch (err) {
    console.error('[analyze] CRITICAL', err);
    store.releaseCronLock(lock);
    store.close();
    process.exit(3);
  } finally {
    store.releaseCronLock(lock);
    store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[analyze] FATAL', e);
    process.exit(1);
  });
}
