#!/usr/bin/env node
// test/eval/multi-metric-eval.mjs — Eval v2 Phase II multi-metric runner.
//
// Coexists with the legacy synthetic runner (run-eval.mjs). This runner:
//   - Reads real fixtures from test/eval/real-fixtures/*.json (written by
//     scripts/extract-ground-truth.mjs). Handles not-yet-existing dir gracefully.
//   - Partitions into train/test (70/30 by default, via splitDate).
//   - Runs phase1 → (gated) phase2 → judge in a parallel pool (concurrency 3).
//   - Computes per-fixture metrics via gap-analyzer.mjs and aggregates per split.
//   - When run directly, writes full JSON results to test/eval/results/.
//
// Usage:
//   node test/eval/multi-metric-eval.mjs
//   (requires ANTHROPIC_API_KEY + `claude` CLI logged in)
//
// As a library:
//   import { runEvalV2 } from './multi-metric-eval.mjs';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYAML } from 'yaml';

import { analyzeGap, aggregate } from './gap-analyzer.mjs';
import { runJudge as defaultRunJudge } from './judge-sonnet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..', '..');
const REAL_FIXTURES_DIR = join(HERE, 'real-fixtures');
const RESULTS_DIR = join(HERE, 'results');
const LABEL_CONFIG_PATH = join(PROJECT_ROOT, 'config', 'label-routing.yaml');

const PHASE2_CONFIDENCE_GATE = 0.5;
const DEFAULT_CONCURRENCY = 3;

/**
 * Run the v2 eval.
 *
 * @param {object} params
 * @param {object[]} params.fixtures - ground-truth fixtures (each has issue + ground_truth)
 * @param {object} params.labelConfig
 * @param {Function} params.phase1Fn - async (context) => phase1 output
 * @param {Function} params.phase2Fn - async (context, phase1) => phase2 output
 * @param {Function} params.judgeFn  - async ({ issue, phase1Output, phase2Output }) => rubric
 * @param {string|Date} params.splitDate - ISO date string; fixtures with closed_at < splitDate are train
 * @param {Function} [params.buildContext] - optional context builder; default builds minimal ctx
 * @param {{info: Function, warn: Function}} [params.logger]
 * @param {number} [params.concurrency]
 * @returns {Promise<object>}
 */
export async function runEvalV2({
  fixtures,
  labelConfig,
  phase1Fn,
  phase2Fn,
  judgeFn,
  splitDate,
  splitFn,
  buildContext = defaultBuildContext,
  logger = { info: () => {}, warn: () => {} },
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const runStart = new Date().toISOString();

  let train;
  let test;
  let splitMeta = { strategy: 'temporal', split_date: null };
  if (typeof splitFn === 'function') {
    const out = splitFn(fixtures || []);
    train = out.train ?? [];
    test = out.test ?? [];
    splitMeta = { strategy: out.strategy ?? 'custom', split_date: splitDate ? new Date(splitDate).toISOString() : null };
  } else {
    const splitTs = splitDate ? new Date(splitDate).getTime() : Date.now();
    train = [];
    test = [];
    for (const fx of fixtures || []) {
      const closedAt = fx?.issue?.closed_at ?? fx?.closed_at;
      const ts = closedAt ? new Date(closedAt).getTime() : null;
      if (ts != null && ts < splitTs) train.push(fx);
      else test.push(fx);
    }
    splitMeta.split_date = splitDate ? new Date(splitDate).toISOString() : null;
  }

  const runOne = async (fx) => {
    try {
      const ctx = buildContext({ fixture: fx, labelConfig });
      const phase1 = await phase1Fn(ctx);
      let phase2 = null;
      if (phase1 && typeof phase1.confidence === 'number' && phase1.confidence >= PHASE2_CONFIDENCE_GATE) {
        phase2 = await phase2Fn(ctx, phase1);
      }
      let judgeResult = null;
      try {
        judgeResult = await judgeFn({
          issue: fx.issue,
          phase1Output: phase1,
          phase2Output: phase2,
        });
      } catch (err) {
        judgeResult = { error: 'judge_exception', raw: String(err?.message ?? err) };
      }
      const metrics = analyzeGap({
        fixture: fx,
        phase1Output: phase1,
        phase2Output: phase2,
        judgeResult,
      });
      return { fixture_id: fx.id ?? fx.issue?.iid, phase1, phase2, judgeResult, metrics };
    } catch (err) {
      logger.warn(`fixture ${fx?.id ?? fx?.issue?.iid} failed: ${err?.message ?? err}`);
      return {
        fixture_id: fx?.id ?? fx?.issue?.iid,
        error: String(err?.message ?? err),
        metrics: null,
      };
    }
  };

  const trainResults = await runPool(train, runOne, concurrency);
  const testResults = await runPool(test, runOne, concurrency);

  const trainMetrics = aggregate(trainResults.map((r) => r.metrics).filter(Boolean));
  const testMetrics = aggregate(testResults.map((r) => r.metrics).filter(Boolean));

  const runEnd = new Date().toISOString();

  return {
    train_metrics: trainMetrics,
    test_metrics: testMetrics,
    per_fixture: [
      ...trainResults.map((r) => ({ split: 'train', ...r })),
      ...testResults.map((r) => ({ split: 'test', ...r })),
    ],
    meta: {
      n_train: train.length,
      n_test: test.length,
      split_date: splitMeta.split_date,
      split_strategy: splitMeta.strategy,
      run_started_at: runStart,
      run_finished_at: runEnd,
      total_cost_usd_estimate: null,
    },
  };
}

// ---- default context builder ------------------------------------------------

function defaultBuildContext({ fixture, labelConfig }) {
  // Minimal builder — doesn't pull in lib/llm/context-builder.mjs so that tests
  // can run without those modules. The CLI wrapper replaces this with the real
  // buildLLMContext.
  return {
    new_issue: {
      id: fixture?.issue?.iid,
      title: fixture?.issue?.title,
      description: fixture?.issue?.description ?? '',
      labels: fixture?.issue?.labels ?? [],
      project_path: fixture?.issue?.project_path ?? '(unknown)',
    },
    similar_issues: fixture?.similar_issues ?? [],
    label_config: labelConfig,
  };
}

// ---- concurrency pool -------------------------------------------------------

async function runPool(items, fn, concurrency) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- CLI --------------------------------------------------------------------

function loadFixtures(dir = REAL_FIXTURES_DIR) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files.sort()) {
    const raw = readFileSync(join(dir, f), 'utf8');
    try {
      out.push(JSON.parse(raw));
    } catch (e) {
      console.error(`skipping malformed fixture ${f}: ${e.message}`);
    }
  }
  return out;
}

function loadLabelConfig(path = LABEL_CONFIG_PATH) {
  if (!existsSync(path)) return { labels: {} };
  return parseYAML(readFileSync(path, 'utf8'));
}

// Deterministic PRNG (mulberry32) — seeded so stratified splits are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stratified split by ground_truth.primary_repo.
 * Each stratum is shuffled (seeded) then split 70/30; strata with n<2 put the
 * single fixture into train. Guarantees both splits see a representative mix.
 *
 * @param {number} [trainFrac=0.7]
 * @param {number} [seed=42]
 * @returns {(fixtures: object[]) => {train: object[], test: object[], strategy: string}}
 */
export function makeStratifiedSplitByPrimaryRepo(trainFrac = 0.7, seed = 42) {
  return function splitFn(fixtures) {
    const strata = new Map();
    for (const fx of fixtures) {
      const key = fx?.ground_truth?.primary_repo ?? '__unknown__';
      if (!strata.has(key)) strata.set(key, []);
      strata.get(key).push(fx);
    }
    const rand = mulberry32(seed);
    const train = [];
    const test = [];
    for (const [, items] of strata) {
      // Fisher-Yates with seeded RNG
      const shuffled = items.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      if (shuffled.length < 2) {
        train.push(...shuffled);
        continue;
      }
      const nTrain = Math.max(1, Math.round(shuffled.length * trainFrac));
      train.push(...shuffled.slice(0, nTrain));
      test.push(...shuffled.slice(nTrain));
    }
    return { train, test, strategy: `stratified_primary_repo(frac=${trainFrac},seed=${seed})` };
  };
}

function defaultSplitDate(fixtures) {
  // 70/30 by closed_at: sort ascending, pick the value at index floor(0.7 * n).
  const dates = fixtures
    .map((f) => f?.issue?.closed_at ?? f?.closed_at)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (dates.length === 0) return new Date().toISOString();
  const idx = Math.floor(dates.length * 0.7);
  const t = dates[Math.min(idx, dates.length - 1)];
  return new Date(t).toISOString();
}

function formatSummary(result) {
  const lines = [];
  const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
  lines.push('=== EVAL v2 SUMMARY ===');
  lines.push(`Split strategy: ${result.meta.split_strategy ?? 'temporal'}`);
  lines.push(`Split date: ${result.meta.split_date}`);
  lines.push(`n_train: ${result.meta.n_train}   n_test: ${result.meta.n_test}`);
  lines.push('');
  lines.push('Metric               |  Train  |   Test');
  lines.push('---------------------|---------|---------');
  const t = result.train_metrics;
  const u = result.test_metrics;
  lines.push(`P@1                  | ${fmt(t.p_at_1)} | ${fmt(u.p_at_1)}`);
  lines.push(`R@3                  | ${fmt(t.r_at_3)} | ${fmt(u.r_at_3)}`);
  lines.push(`Cross-repo recall    | ${fmt(t.cross_repo_recall_avg)} | ${fmt(u.cross_repo_recall_avg)}`);
  lines.push(`Assignee R@3         | ${fmt(t.assignee_r_at_3)} | ${fmt(u.assignee_r_at_3)}`);
  lines.push(`ECE                  | ${fmt(t.ece)} | ${fmt(u.ece)}`);
  lines.push(`Judge avg            | ${fmt(t.judge_avg)} | ${fmt(u.judge_avg)}`);
  return lines.join('\n');
}

async function mainCLI() {
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error(
      JSON.stringify({
        error: 'no fixtures found',
        dir: REAL_FIXTURES_DIR,
        hint: 'Run: node scripts/extract-ground-truth.mjs --label K5 --limit 150',
      })
    );
    process.exit(1);
  }

  const labelConfig = loadLabelConfig();

  // Lazy-load the real LLM pipeline so tests / offline environments don't
  // need the SDK present.
  const [{ buildLLMContext }, { runPhase1Routing }, { runPhase2Plan }] = await Promise.all([
    import(pathToFileURL(join(PROJECT_ROOT, 'lib', 'llm', 'context-builder.mjs')).href),
    import(pathToFileURL(join(PROJECT_ROOT, 'lib', 'llm', 'phase1-routing.mjs')).href),
    import(pathToFileURL(join(PROJECT_ROOT, 'lib', 'llm', 'phase2-plan.mjs')).href),
  ]);

  const buildContext = ({ fixture, labelConfig: lc }) =>
    buildLLMContext({
      new_issue: {
        id: fixture.issue.iid,
        title: fixture.issue.title,
        description: fixture.issue.description ?? '',
        labels: fixture.issue.labels ?? [],
        project_path: fixture.issue.project_path ?? '(unknown)',
      },
      similar_issues: fixture.similar_issues ?? [],
      label_config: lc,
    });

  const strategy = process.env.EVAL_SPLIT_STRATEGY || 'temporal';
  const splitDate = defaultSplitDate(fixtures);
  const splitFn = strategy === 'stratified' ? makeStratifiedSplitByPrimaryRepo() : undefined;

  const result = await runEvalV2({
    fixtures,
    labelConfig,
    phase1Fn: (ctx) => runPhase1Routing(ctx),
    phase2Fn: (ctx, phase1) => runPhase2Plan(ctx, phase1),
    judgeFn: defaultRunJudge,
    splitDate,
    splitFn,
    buildContext,
    logger: { info: (m) => console.error(`[info] ${m}`), warn: (m) => console.error(`[warn] ${m}`) },
  });

  console.log(formatSummary(result));

  // Write full JSON
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const outPath = join(RESULTS_DIR, `eval-${ts}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.error(`\nFull results: ${outPath}`);
}

const isDirectRun =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  process.argv[1]?.endsWith('multi-metric-eval.mjs');

if (isDirectRun) {
  mainCLI().catch((err) => {
    console.error(JSON.stringify({ error: err?.message ?? String(err), stack: err?.stack }));
    process.exit(1);
  });
}
