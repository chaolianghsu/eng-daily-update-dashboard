#!/usr/bin/env node
// scripts/collect-new-issues.mjs — Stage 1 of issue routing DAG.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task D1.
//
// Runs on cron (every 15 min). For each configured project path:
//   1. Resolve project id (cached per run)
//   2. Fetch open issues via GitLab API
//   3. Compute content hash (labels + description + state)
//   4. Skip if state row exists with matching hash (no-op)
//   5. Otherwise upsert → marks as "queued for analysis"
//
// Concurrency: file-based cron lock. If another instance holds the lock,
// this process exits with code 0 (not an error — cron is overlapping).
//
// Exit codes:
//   0 — success, or another instance is running
//   1 — unexpected error (caught in main())
//   2 — invalid config (yaml or gitlab-config.json)
//   3 — GitLab API unreachable after retries (GitLabApiError)

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createStateStore } from '../lib/state.mjs';
import { createGitLabClient, GitLabApiError } from '../lib/gitlab-client.mjs';
import { loadLabelRouting, validateConfig } from '../lib/config.mjs';
import { hashIssueContent } from '../lib/hash.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const DEFAULT_PROJECT_PATHS = [
  'techcenter/reportcenter',
  'techcenter/reportcenter_confidential',
];

/**
 * Pure orchestration — all IO deps injected for testability.
 *
 * @param {object} opts
 * @param {object} opts.stateStore    — createStateStore() instance
 * @param {object} opts.client        — createGitLabClient() instance (or mock)
 * @param {string[]} opts.projectPaths
 * @param {object} [opts.logger]      — defaults to console
 * @param {() => number} [opts.now]   — returns unix epoch seconds
 * @returns {Promise<{processed: number, queued: number, skipped: number}>}
 */
export async function runCollect({
  stateStore,
  client,
  projectPaths,
  logger = console,
  now = () => Math.floor(Date.now() / 1000),
}) {
  let processed = 0;
  let queued = 0;
  let skipped = 0;

  // Per-run cache: project_path → project_id
  const projectIdCache = new Map();

  for (const path of projectPaths) {
    let projectId = projectIdCache.get(path);
    if (projectId === undefined) {
      projectId = await client.resolveProjectId(path);
      projectIdCache.set(path, projectId);
    }

    const issues = await client.fetchOpenIssues(path);

    for (const issue of issues) {
      processed += 1;

      const uid = `${projectId}:${issue.iid}`;
      const hash = hashIssueContent({
        labels: issue.labels || [],
        description: issue.description || '',
        state: issue.state,
      });

      const existing = stateStore.get(uid);
      if (existing && existing.last_analysis_hash === hash) {
        skipped += 1;
        continue;
      }

      const ts = now();
      const isNew = !existing;
      stateStore.upsert({
        issue_uid: uid,
        gitlab_url: issue.web_url,
        labels: issue.labels || [],
        last_analysis_hash: hash,
        status: existing?.status || 'open',
        // upsert preserves created_at via COALESCE on updated-path; pass ts for insert-path
        created_at: existing?.created_at ?? ts,
        updated_at: ts,
      });
      queued += 1;

      logger.log(
        `[collect] queued ${uid} hash=${hash.slice(0, 8)} (${isNew ? 'new' : 'changed'})`,
      );
    }
  }

  logger.log(
    `[collect] run complete: processed ${processed} issues across ${projectPaths.length} projects, ${queued} queued for analysis`,
  );

  return { processed, queued, skipped };
}

/**
 * Real entry point — reads files, constructs deps, manages cron lock.
 * Returns the exit code to use (so tests could also exercise this, though
 * the integration suite focuses on runCollect directly).
 */
async function main() {
  let gitlabCfg;
  try {
    const gitlabConfigPath = process.env.GITLAB_CONFIG || join(REPO_ROOT, 'gitlab-config.json');
    gitlabCfg = JSON.parse(readFileSync(gitlabConfigPath, 'utf8'));

    // Validate label-routing config up-front so a broken YAML fails the cron run
    // here (exit 2) rather than deep inside the analyze-and-post stage.
    const labelConfigPath = process.env.LABEL_CONFIG || join(REPO_ROOT, 'config', 'label-routing.yaml');
    validateConfig(loadLabelRouting(labelConfigPath));
  } catch (err) {
    console.error('[collect] invalid config:', err.message);
    process.exit(2);
  }

  const dbPath = process.env.STATE_DB || join(REPO_ROOT, 'db', 'issue-routing.sqlite');
  const store = createStateStore(dbPath);

  const lock = store.acquireCronLock();
  if (!lock) {
    console.log('[collect] another instance holds the cron lock, skipping this run');
    store.close();
    process.exit(0);
  }

  try {
    const client = createGitLabClient({
      baseUrl: gitlabCfg.baseUrl,
      token: gitlabCfg.token,
    });

    const projectPaths = (process.env.PROJECTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const paths = projectPaths.length > 0 ? projectPaths : DEFAULT_PROJECT_PATHS;

    try {
      await runCollect({
        stateStore: store,
        client,
        projectPaths: paths,
      });
    } catch (err) {
      if (err instanceof GitLabApiError) {
        console.error(
          `[collect] GitLab API error (status=${err.status}, endpoint=${err.endpoint}, retries=${err.retries}): ${err.message}`,
        );
        process.exit(3);
      }
      throw err;
    }
  } finally {
    store.releaseCronLock(lock);
    store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[collect] FATAL', e);
    process.exit(1);
  });
}
