#!/usr/bin/env node
// scripts/spike-phase0.5.mjs — Phase 0.5 routing-enrichment A/B spike.
//
// Standalone runner. Does NOT modify production code. For each K5 GOLD
// fixture:
//   1) Build the baseline Phase-1 prompt (same as phase1-routing.mjs does)
//   2) Run it through `claude --print` → capture phase1_baseline
//   3) Build an ENRICHED prompt = baseline + formatted RECENT REPO ACTIVITY
//      (fetched from GitLab for the K5 candidate repos)
//   4) Run enriched through the CLI → capture phase1_enriched
//   5) Compare suggested_repos vs ground_truth, confidence, reasoning
//
// Writes a markdown A/B report to test/eval/results/spike-phase0.5-ab-<date>.md.
//
// Run:
//   node scripts/spike-phase0.5.mjs
//
// Env:
//   - GITLAB_CONFIG_PATH (optional) — override gitlab-config.json path
//   - SPIKE_SINCE_DAYS   (optional) — default 7 (recent-activity window)
//   - SPIKE_LIMIT        (optional) — max fixtures to run (default all K5 GOLD)

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYAML } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURE_DIR = join(ROOT, 'test', 'eval', 'real-fixtures');
const RESULTS_DIR = join(ROOT, 'test', 'eval', 'results');
const LABEL_CONFIG_PATH = join(ROOT, 'config', 'label-routing.yaml');
const GITLAB_CONFIG_PATH = process.env.GITLAB_CONFIG_PATH || join(ROOT, 'gitlab-config.json');

const SINCE_DAYS = Number(process.env.SPIKE_SINCE_DAYS ?? 7);
const FIXTURE_LIMIT = process.env.SPIKE_LIMIT ? Number(process.env.SPIKE_LIMIT) : Infinity;

// ---- lazy imports of production helpers (read-only usage) -------------------

const [
  { buildLLMContext, extractFantiLayers },
  { callClaudeCliWithTool },
  { fetchRepoActivity, formatActivityForPrompt },
  { ROUTING_TOOL },
] = await Promise.all([
  import(pathToFileURL(join(ROOT, 'lib', 'llm', 'context-builder.mjs')).href),
  import(pathToFileURL(join(ROOT, 'lib', 'llm', 'cli-fallback.mjs')).href),
  import(pathToFileURL(join(ROOT, 'lib', 'llm', 'repo-activity-enricher.mjs')).href),
  import(pathToFileURL(join(ROOT, 'lib', 'llm', 'phase1-routing.mjs')).href),
]);

// Inline GitLab apiCall — mirrors `lib/gitlab-client.mjs` but exposes the
// raw-path call so we can hit /merge_requests and /repository/commits without
// modifying the production client surface.
function makeApiCall({ baseUrl, token }) {
  return async function apiCall(endpoint) {
    const url = `${baseUrl}/api/v4${endpoint}`;
    const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } });
    if (!res.ok) {
      const err = new Error(`GitLab ${res.status} ${res.statusText ?? ''}`.trim());
      err.status = res.status;
      err.endpoint = endpoint;
      throw err;
    }
    return await res.json();
  };
}

// ---- main -------------------------------------------------------------------

async function main() {
  const fixtures = loadK5GoldFixtures().slice(0, FIXTURE_LIMIT);
  if (fixtures.length === 0) {
    console.error('No K5 GOLD fixtures found.');
    process.exit(1);
  }

  const labelConfig = parseYAML(readFileSync(LABEL_CONFIG_PATH, 'utf8'));
  const k5Candidates = extractK5Candidates(labelConfig);
  if (k5Candidates.length === 0) {
    console.error('config/label-routing.yaml has no K5 candidates.');
    process.exit(1);
  }

  console.error(`[spike] ${fixtures.length} fixture(s), ${k5Candidates.length} K5 candidate repos`);

  // ---- Phase 0.5 v2: per-fixture historical activity windows ---------------
  // v1 (b11e052) used a single `since = now - 7d` window, which fetched April MRs
  // for our January GOLD fixtures → enrichment was useless for #302 whose actual
  // fix MRs (!361, !363) are from Jan 13-15. v2 anchors the window to each
  // fixture's issue.closed_at ± 7d (with +1d upper bound to catch fix-on-close).
  const gitlabCfg = JSON.parse(readFileSync(GITLAB_CONFIG_PATH, 'utf8'));
  const apiCall = makeApiCall({ baseUrl: gitlabCfg.baseUrl, token: gitlabCfg.token });

  // ---- Per-fixture A/B -----------------------------------------------------
  const results = [];
  for (const fx of fixtures) {
    const ctx = buildLLMContext({
      new_issue: {
        id: fx.issue.iid,
        title: fx.issue.title,
        description: fx.issue.description ?? '',
        labels: fx.issue.labels ?? [],
        project_path: fx.issue.project_path ?? '(unknown)',
      },
      similar_issues: fx.similar_issues ?? [],
      label_config: labelConfig,
    });

    // Compute per-fixture historical activity window anchored to closed_at.
    const closedAt = new Date(fx.issue.closed_at);
    const sinceDate = new Date(closedAt.getTime() - SINCE_DAYS * 24 * 3600 * 1000).toISOString();
    const untilDate = new Date(closedAt.getTime() + 1 * 24 * 3600 * 1000).toISOString();

    console.error(
      `[spike] fixture ${fx.issue.iid}: fetching activity window ${sinceDate} → ${untilDate}...`,
    );
    const activityStart = Date.now();
    const activity = await fetchRepoActivity({
      apiCall,
      candidateRepos: k5Candidates,
      sinceDate,
      untilDate,
      mrLimit: 5,
      commitLimit: 10,
      concurrency: 5,
      warn: (m) => console.error(`[gitlab] ${m}`),
    });
    const activityMs = Date.now() - activityStart;
    const activityBlock = formatActivityForPrompt(activity);
    console.error(
      `[spike] fixture ${fx.issue.iid}: activity fetched in ${activityMs}ms — ` +
        `${Object.keys(activity.byRepo).length} repos, ~${activity.total_tokens_estimate} tokens`,
    );

    console.error(`[spike] fixture ${fx.issue.iid}: running BASELINE...`);
    const baseStart = Date.now();
    const baseline = await runPhase1CLI({ ctx, activityBlock: null });
    const baseMs = Date.now() - baseStart;

    console.error(`[spike] fixture ${fx.issue.iid}: running ENRICHED...`);
    const enrStart = Date.now();
    const enriched = await runPhase1CLI({ ctx, activityBlock });
    const enrMs = Date.now() - enrStart;

    const groundRepos = fx.ground_truth?.fix_repos ?? [];
    const primary = fx.ground_truth?.primary_repo ?? null;

    results.push({
      iid: fx.issue.iid,
      title: fx.issue.title,
      ground_truth: { fix_repos: groundRepos, primary_repo: primary },
      window: { since: sinceDate, until: untilDate, closed_at: fx.issue.closed_at },
      activity: {
        block: activityBlock,
        total_tokens_estimate: activity.total_tokens_estimate,
        repos_fetched: Object.keys(activity.byRepo).length,
        fetch_ms: activityMs,
      },
      baseline: {
        ...baseline.parsed,
        error: baseline.error,
        latency_ms: baseMs,
        prompt_chars: baseline.promptChars,
      },
      enriched: {
        ...enriched.parsed,
        error: enriched.error,
        latency_ms: enrMs,
        prompt_chars: enriched.promptChars,
      },
      metrics: {
        baseline: scoreRouting(baseline.parsed, primary, groundRepos),
        enriched: scoreRouting(enriched.parsed, primary, groundRepos),
      },
    });
  }

  // ---- Aggregate -----------------------------------------------------------
  const agg = aggregateMetrics(results);

  // ---- Report --------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportPath = join(RESULTS_DIR, `spike-phase0.5-v2-ab-${today}.md`);
  writeFileSync(reportPath, renderReport({ results, agg, k5Candidates }));
  console.error(`[spike] wrote ${reportPath}`);
  console.error('');
  console.error(renderSummary(agg));
}

// ---- helpers ----------------------------------------------------------------

function loadK5GoldFixtures() {
  if (!existsSync(FIXTURE_DIR)) return [];
  const out = [];
  for (const f of readdirSync(FIXTURE_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    if (!f.startsWith('k5-')) continue;
    let fx;
    try {
      fx = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    if (fx?.tier !== 'GOLD') continue;
    out.push(fx);
  }
  return out;
}

function extractK5Candidates(labelConfig) {
  const exc = labelConfig?.labels?.K5?.known_exceptions ?? [];
  // Filter to full project paths (skip group names like "bigdata1" from other labels' notes).
  // A path is "group/project" i.e. contains at least one `/`. Shallow group names aren't
  // directly fetchable via GitLab project APIs.
  return exc.filter((p) => typeof p === 'string' && p.includes('/'));
}

function buildBaselineSystemPrompt(ctx) {
  const fantiLayers = extractFantiLayers(ctx?.label_config);
  const hasFanti = (ctx?.new_issue?.labels ?? []).includes('Fanti');
  const layerGuidance = hasFanti && fantiLayers
    ? [
        '- 如果 issue 帶有 Fanti label,必須從以下 layer enum 選一個:',
        ...Object.keys(fantiLayers).map((k) => `    * ${k}`),
        '    * unsure (資訊不足時使用)',
      ].join('\n')
    : '- 如果 issue 沒有 Fanti label,layer 必須填 "n/a"。';

  return [
    '你是一個工程 team 的 GitLab issue triage 助理。',
    '你的工作是根據新 issue 的內容,加上少量相似歷史 issue,做路由建議 (suggested repos + assignees) 並給一個 0.0-1.0 的信心分數。',
    '',
    '重要規則:',
    '- suggested_repos 只能從 label_config 中該 label 的 candidates / layers 列表挑選,絕對不要發明不存在的 repo。',
    layerGuidance,
    '- 若歷史 issue 稀疏、資訊不足,或是冷啟動 (cold start),confidence 必須 < 0.5,並把理由放進 caveats。',
    '- reasoning 用 1-2 句繁體中文 (zh-TW) 說明判斷依據。',
    '- caveats 列出任何 triage 人員應該要注意的不確定性 (例如: "歷史只有 1 筆相似 issue")。',
    '- suggested_assignees 用過去實際處理過類似 issue 的人員 username (最多 3 個)。',
    '',
    '請用 route_issue tool 回傳結構化結果。',
  ].join('\n');
}

function buildEnrichedSystemPrompt(ctx) {
  const base = buildBaselineSystemPrompt(ctx);
  // Swap final sentence for enriched guidance.
  const enrichedTail = [
    '',
    '額外規則 (Phase 0.5 spike):',
    '- 下方 user message 會附上 "RECENT REPO ACTIVITY" 區塊,列出候選 repo 近期的 open MR + commit。',
    '- Use the RECENT REPO ACTIVITY block to inform routing — 如果某個 repo 近期有 MR title / commit message 明顯對應此 issue 的症狀,那個 repo 就是強候選。若活動與 issue 無關,請忽略活動資訊、依 label + 描述推斷。',
    '- 不要因為活動多就傾向選那個 repo —— 關鍵是「活動內容是否對應此 issue」。',
    '',
    '請用 route_issue tool 回傳結構化結果。',
  ].join('\n');
  // Replace the original last sentence ("請用 route_issue tool 回傳結構化結果。")
  // with the enriched tail so we don't double up.
  const withoutTail = base.replace(/請用 route_issue tool 回傳結構化結果。\s*$/s, '').trimEnd();
  return withoutTail + '\n' + enrichedTail;
}

function buildBaselineUserPrompt(ctx) {
  const { new_issue, similar_issues = [], label_config } = ctx;
  const labelsLine = (new_issue.labels || []).join(', ') || '(none)';
  const newIssueBlock = [
    '=== NEW ISSUE ===',
    `Title: ${new_issue.title}`,
    `Labels: ${labelsLine}`,
    `Project: ${new_issue.project_path ?? '(unknown)'}`,
    'Description:',
    new_issue.description ?? '',
  ].join('\n');
  const labelConfigBlock = [
    '=== LABEL CONFIG ===',
    JSON.stringify(label_config, null, 2),
  ].join('\n');
  const similarBlock =
    !similar_issues || similar_issues.length === 0
      ? '=== SIMILAR PAST ISSUES ===\nNO SIMILAR ISSUES FOUND — cold start. Set confidence ≤ 0.5.'
      : ['=== SIMILAR PAST ISSUES ===',
          similar_issues
            .map((s, i) => {
              const lbls = (s.labels || []).join(', ') || '(none)';
              const hint = s.resolution_hint ? `\nResolution hint: ${s.resolution_hint}` : '';
              return [
                `[${i + 1}] #${s.iid} "${s.title}"`,
                `Labels: ${lbls}`,
                `Assignee: ${s.assignee ?? '(none)'}`,
                `Closing excerpt: ${s.closing_excerpt ?? ''}${hint}`,
              ].join('\n');
            })
            .join('\n---\n'),
        ].join('\n');
  return [
    newIssueBlock,
    '',
    labelConfigBlock,
    '',
    similarBlock,
    '',
    '請 invoke route_issue tool 回傳你的結構化建議。',
  ].join('\n');
}

function buildEnrichedUserPrompt(ctx, activityBlock) {
  const base = buildBaselineUserPrompt(ctx);
  // Insert the activity block just before the final invoke line.
  const invokeLine = '請 invoke route_issue tool 回傳你的結構化建議。';
  const trimmed = base.replace(new RegExp(`\\n?${invokeLine}\\s*$`), '');
  return [trimmed, '', activityBlock, '', invokeLine].join('\n');
}

async function runPhase1CLI({ ctx, activityBlock }) {
  const system = activityBlock
    ? buildEnrichedSystemPrompt(ctx)
    : buildBaselineSystemPrompt(ctx);
  const user = activityBlock
    ? buildEnrichedUserPrompt(ctx, activityBlock)
    : buildBaselineUserPrompt(ctx);
  const combined = `${system}\n\n${user}`;

  try {
    const response = await callClaudeCliWithTool({
      prompt: combined,
      toolSchema: ROUTING_TOOL,
      model: 'sonnet',
      timeoutMs: 120_000,
    });
    const tu = (response.content ?? []).find(
      (b) => b?.type === 'tool_use' && b?.name === 'route_issue',
    );
    return { parsed: tu?.input ?? null, promptChars: combined.length, error: null };
  } catch (err) {
    return {
      parsed: null,
      promptChars: combined.length,
      error: `${err?.code ?? 'error'}: ${err?.message ?? err}`,
    };
  }
}

function scoreRouting(parsed, primary, groundRepos) {
  if (!parsed || !Array.isArray(parsed.suggested_repos)) {
    return { p_at_1: false, r_at_3: false, confidence: null };
  }
  const top = parsed.suggested_repos;
  const top3 = top.slice(0, 3);
  const p1 = primary && top[0] === primary;
  const r3 = groundRepos.some((g) => top3.includes(g));
  return {
    p_at_1: Boolean(p1),
    r_at_3: Boolean(r3),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
  };
}

function aggregateMetrics(results) {
  const n = results.length;
  const sum = (pick) => results.reduce((acc, r) => acc + (pick(r) ? 1 : 0), 0);
  const avg = (pick) => {
    const xs = results.map(pick).filter((x) => typeof x === 'number' && !Number.isNaN(x));
    if (xs.length === 0) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };

  const baseP1 = sum((r) => r.metrics.baseline.p_at_1);
  const enrP1 = sum((r) => r.metrics.enriched.p_at_1);
  const baseR3 = sum((r) => r.metrics.baseline.r_at_3);
  const enrR3 = sum((r) => r.metrics.enriched.r_at_3);
  const baseConf = avg((r) => r.metrics.baseline.confidence);
  const enrConf = avg((r) => r.metrics.enriched.confidence);

  const basePromptChars = avg((r) => r.baseline.prompt_chars);
  const enrPromptChars = avg((r) => r.enriched.prompt_chars);
  const baseLatency = avg((r) => r.baseline.latency_ms);
  const enrLatency = avg((r) => r.enriched.latency_ms);

  return {
    n,
    baseline: {
      p_at_1_hits: baseP1,
      p_at_1: n ? baseP1 / n : 0,
      r_at_3_hits: baseR3,
      r_at_3: n ? baseR3 / n : 0,
      conf_avg: baseConf,
      prompt_chars_avg: basePromptChars,
      latency_ms_avg: baseLatency,
    },
    enriched: {
      p_at_1_hits: enrP1,
      p_at_1: n ? enrP1 / n : 0,
      r_at_3_hits: enrR3,
      r_at_3: n ? enrR3 / n : 0,
      conf_avg: enrConf,
      prompt_chars_avg: enrPromptChars,
      latency_ms_avg: enrLatency,
    },
  };
}

function renderSummary(agg) {
  const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
  const num = (x, d = 2) => (x == null ? 'n/a' : Number(x).toFixed(d));
  return [
    '=== SPIKE Phase 0.5 A/B SUMMARY ===',
    `n=${agg.n}`,
    `P@1:        baseline=${agg.baseline.p_at_1_hits}/${agg.n} (${pct(agg.baseline.p_at_1)})   enriched=${agg.enriched.p_at_1_hits}/${agg.n} (${pct(agg.enriched.p_at_1)})`,
    `R@3:        baseline=${agg.baseline.r_at_3_hits}/${agg.n} (${pct(agg.baseline.r_at_3)})   enriched=${agg.enriched.r_at_3_hits}/${agg.n} (${pct(agg.enriched.r_at_3)})`,
    `Confidence: baseline=${num(agg.baseline.conf_avg)}   enriched=${num(agg.enriched.conf_avg)}`,
    `Prompt chr: baseline=${num(agg.baseline.prompt_chars_avg, 0)}   enriched=${num(agg.enriched.prompt_chars_avg, 0)}`,
    `Latency ms: baseline=${num(agg.baseline.latency_ms_avg, 0)}   enriched=${num(agg.enriched.latency_ms_avg, 0)}`,
  ].join('\n');
}

function verdictFrom(agg) {
  const enrP1Hits = agg.enriched.p_at_1_hits;
  if (enrP1Hits >= Math.ceil(agg.n / 3)) return 'PROCEED-TO-PROD';
  if (enrP1Hits > agg.baseline.p_at_1_hits) return 'NEEDS-MORE-DATA';
  return 'ABORT';
}

function renderReport({ results, agg, k5Candidates }) {
  const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
  const num = (x, d = 2) => (x == null ? 'n/a' : Number(x).toFixed(d));
  const verdict = verdictFrom(agg);

  const lines = [];
  lines.push('# Phase 0.5 Spike v2 — Repo Activity Enrichment A/B (historical window)');
  lines.push('');
  lines.push(`Run date: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Setup');
  lines.push('');
  lines.push(`- Fixtures: ${agg.n} K5 GOLD (${results.map((r) => r.iid).join(', ')})`);
  lines.push(`- Baseline source: identical to production \`phase1-routing.mjs\` prompt (CLI mode, model=sonnet)`);
  lines.push(`- Enrichment recipe: baseline prompt + \`RECENT REPO ACTIVITY\` block appended before the invoke line`);
  lines.push(`- Activity window: **per-fixture historical** — anchored to each fixture's \`issue.closed_at\` (−${process.env.SPIKE_SINCE_DAYS ?? 7}d to +1d)`);
  lines.push(`- MR query: \`state=all\` with \`updated_after/updated_before\` (v2; v1 used \`state=opened\` which misses already-merged fix MRs)`);
  lines.push(`- Candidate repos fetched: ${k5Candidates.length}`);
  lines.push('');
  lines.push('### Per-fixture activity windows');
  lines.push('');
  lines.push('| iid | closed_at | since | until | activity tokens | fetch ms |');
  lines.push('|-----|-----------|-------|-------|-----------------|----------|');
  for (const r of results) {
    lines.push(`| ${r.iid} | ${r.window.closed_at} | ${r.window.since} | ${r.window.until} | ~${r.activity.total_tokens_estimate} | ${r.activity.fetch_ms} |`);
  }
  lines.push('');

  lines.push('## Per-fixture diff');
  lines.push('');
  lines.push('| iid | ground_truth | baseline_top3 | enriched_top3 | P@1 b/e | R@3 b/e | conf b/e | reasoning (enriched) |');
  lines.push('|-----|--------------|---------------|---------------|---------|---------|----------|----------------------|');
  for (const r of results) {
    const gt = r.ground_truth.primary_repo ?? '(none)';
    const bTop = (r.baseline?.suggested_repos ?? []).slice(0, 3).join(', ') || '(n/a)';
    const eTop = (r.enriched?.suggested_repos ?? []).slice(0, 3).join(', ') || '(n/a)';
    const bP1 = r.metrics.baseline.p_at_1 ? '✓' : '✗';
    const eP1 = r.metrics.enriched.p_at_1 ? '✓' : '✗';
    const bR3 = r.metrics.baseline.r_at_3 ? '✓' : '✗';
    const eR3 = r.metrics.enriched.r_at_3 ? '✓' : '✗';
    const bc = num(r.metrics.baseline.confidence);
    const ec = num(r.metrics.enriched.confidence);
    const reason = (r.enriched?.reasoning ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 220);
    lines.push(`| ${r.iid} | ${gt} | ${bTop} | ${eTop} | ${bP1}/${eP1} | ${bR3}/${eR3} | ${bc}/${ec} | ${reason} |`);
  }
  lines.push('');

  lines.push('## Aggregate comparison');
  lines.push('');
  lines.push('| Metric | Baseline | Enriched | Δ |');
  lines.push('|--------|----------|----------|---|');
  const d = (a, b) => {
    if (a == null || b == null) return 'n/a';
    return (b - a >= 0 ? '+' : '') + (b - a).toFixed(2);
  };
  lines.push(`| P@1 | ${pct(agg.baseline.p_at_1)} (${agg.baseline.p_at_1_hits}/${agg.n}) | ${pct(agg.enriched.p_at_1)} (${agg.enriched.p_at_1_hits}/${agg.n}) | ${d(agg.baseline.p_at_1, agg.enriched.p_at_1)} |`);
  lines.push(`| R@3 | ${pct(agg.baseline.r_at_3)} (${agg.baseline.r_at_3_hits}/${agg.n}) | ${pct(agg.enriched.r_at_3)} (${agg.enriched.r_at_3_hits}/${agg.n}) | ${d(agg.baseline.r_at_3, agg.enriched.r_at_3)} |`);
  lines.push(`| Conf avg | ${num(agg.baseline.conf_avg)} | ${num(agg.enriched.conf_avg)} | ${d(agg.baseline.conf_avg, agg.enriched.conf_avg)} |`);
  lines.push(`| Prompt chars (avg) | ${num(agg.baseline.prompt_chars_avg, 0)} | ${num(agg.enriched.prompt_chars_avg, 0)} | ${d(agg.baseline.prompt_chars_avg, agg.enriched.prompt_chars_avg)} |`);
  lines.push(`| Latency ms (avg) | ${num(agg.baseline.latency_ms_avg, 0)} | ${num(agg.enriched.latency_ms_avg, 0)} | ${d(agg.baseline.latency_ms_avg, agg.enriched.latency_ms_avg)} |`);
  const tokenB = Math.ceil((agg.baseline.prompt_chars_avg ?? 0) / 4);
  const tokenE = Math.ceil((agg.enriched.prompt_chars_avg ?? 0) / 4);
  const costB = (tokenB / 1_000_000) * 3; // Sonnet input ~$3/M (rough)
  const costE = (tokenE / 1_000_000) * 3;
  lines.push(`| Tokens (est, input) | ~${tokenB} | ~${tokenE} | +${tokenE - tokenB} |`);
  lines.push(`| Input cost (est, $ per issue) | $${costB.toFixed(4)} | $${costE.toFixed(4)} | +$${(costE - costB).toFixed(4)} |`);
  lines.push('');

  lines.push('## Verdict');
  lines.push('');
  const verdictNotes = {
    'PROCEED-TO-PROD':
      'Enriched prompt hits P@1 ≥ 1/3 on GOLD fixtures — worth wiring into production phase1 behind a feature flag and re-running full eval.',
    'NEEDS-MORE-DATA':
      'Enriched prompt moves the needle (more R@3 hits, or higher confidence) but not P@1. Rerun with a larger fixture set before deciding.',
    ABORT:
      'Enriched prompt did not improve P@1 over baseline on this sample. Likely the repo-activity signal is too noisy at 7-day window, or the candidate-repo list is too long to be discriminative. Do not productionize as-is.',
  };
  lines.push(`**${verdict}** — ${verdictNotes[verdict]}`);
  lines.push('');
  lines.push('> n=3 is direction only, not statistical proof. Recommend re-running on ≥10 GOLD fixtures before committing to a prod change.');
  lines.push('');

  lines.push('## Raw per-fixture outputs');
  lines.push('');
  for (const r of results) {
    lines.push(`### Fixture ${r.iid} — ${r.title}`);
    lines.push('');
    lines.push(`**Ground truth:** primary=\`${r.ground_truth.primary_repo}\`, all=${JSON.stringify(r.ground_truth.fix_repos)}`);
    lines.push(`**Window:** since=\`${r.window.since}\`, until=\`${r.window.until}\` (anchored to closed_at=\`${r.window.closed_at}\`)`);
    lines.push('');
    lines.push('**Activity block (as injected):**');
    lines.push('```');
    lines.push(r.activity.block);
    lines.push('```');
    lines.push('');
    lines.push('**Baseline**:');
    lines.push('```json');
    lines.push(JSON.stringify({ ...r.baseline }, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('**Enriched**:');
    lines.push('```json');
    lines.push(JSON.stringify({ ...r.enriched }, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- entrypoint -------------------------------------------------------------

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
