// test/unit/eval-v2-scaffold.test.mjs — unit tests for Eval v2 Phase II scaffold.
// Covers pure logic: gap analyzer, aggregator (ECE), runner partition, judge prompt + parser.
// All LLM / phase fns / judge are mocked.

import { describe, it, expect, vi } from 'vitest';
import {
  analyzeGap,
  aggregate,
  confidenceBucket,
} from '../../test/eval/gap-analyzer.mjs';
import {
  runEvalV2,
  makeStratifiedSplitByPrimaryRepo,
  buildPreservingSplitFn,
  mergeEvalResults,
  parseRerunArgs,
} from '../../test/eval/multi-metric-eval.mjs';
import {
  buildJudgePrompt,
  parseJudgeOutput,
  runJudge,
} from '../../test/eval/judge-sonnet.mjs';

// ---- fixtures / helpers -----------------------------------------------------

function baseFixture(overrides = {}) {
  return {
    id: overrides.id ?? 'fx-1',
    issue: {
      iid: 5020,
      title: 'ETL pipeline OOM',
      description: 'Worker runs out of memory each night since 3/15.',
      labels: overrides.labels ?? ['BD', 'P1_高'],
      project_path: 'bigdata/etl-pipeline',
      closed_at: overrides.closed_at ?? '2026-03-01T00:00:00Z',
    },
    similar_issues: overrides.similar_issues ?? [],
    ground_truth: {
      primary_repo: 'bigdata/etl-pipeline',
      fix_repos: ['bigdata/etl-pipeline'],
      assignee: 'nick.huang',
      outcome: overrides.outcome ?? 'likely_fixed',
      ...(overrides.ground_truth || {}),
    },
  };
}

function basePhase1(overrides = {}) {
  return {
    layer: 'n/a',
    suggested_repos: ['bigdata/etl-pipeline'],
    suggested_assignees: ['nick.huang', 'annie.chen'],
    reasoning: '歷史類似 issue 均指向 ETL pipeline。',
    confidence: 0.8,
    caveats: [],
    ...overrides,
  };
}

function basePhase2(overrides = {}) {
  return {
    summary: '使用者回報每晚 ETL 失敗,OOM。',
    plan_draft: ['調整 batch_size', '加入 memory watermark', '寫 regression test'],
    ...overrides,
  };
}

function baseJudge(overrides = {}) {
  return {
    relevance: 5,
    actionability: 4,
    correctness: 4,
    coverage: 4,
    avg: 4.25,
    reasoning: '提案指向正確的 repo。',
    ...overrides,
  };
}

// ---- analyzeGap -------------------------------------------------------------

describe('analyzeGap', () => {
  it('P@1 hit when top suggested_repos[0] matches ground_truth.primary_repo', () => {
    const m = analyzeGap({
      fixture: baseFixture(),
      phase1Output: basePhase1(),
      phase2Output: basePhase2(),
      judgeResult: baseJudge(),
    });
    expect(m.routing.p_at_1).toBe(true);
  });

  it('P@1 miss when top suggested repo does not match primary_repo', () => {
    const m = analyzeGap({
      fixture: baseFixture(),
      phase1Output: basePhase1({ suggested_repos: ['wrong/repo', 'bigdata/etl-pipeline'] }),
      phase2Output: basePhase2(),
      judgeResult: baseJudge(),
    });
    expect(m.routing.p_at_1).toBe(false);
    expect(m.routing.r_at_3).toBe(true); // still in top 3
  });

  it('cross_repo_recall is fraction of ground_truth.fix_repos present in suggestions', () => {
    const fx = baseFixture({
      ground_truth: {
        primary_repo: 'repoA',
        fix_repos: ['repoA', 'repoB', 'repoC'],
        assignee: 'alice',
        outcome: 'likely_fixed',
      },
    });
    const m = analyzeGap({
      fixture: fx,
      phase1Output: basePhase1({ suggested_repos: ['repoA', 'repoB', 'other'] }),
      phase2Output: basePhase2(),
      judgeResult: baseJudge(),
    });
    expect(m.routing.cross_repo_recall).toBeCloseTo(2 / 3);
  });

  it('assignee R@3 hit when ground truth assignee in top 3 suggestions', () => {
    const m = analyzeGap({
      fixture: baseFixture(),
      phase1Output: basePhase1({ suggested_assignees: ['x', 'nick.huang', 'z'] }),
      phase2Output: basePhase2(),
      judgeResult: baseJudge(),
    });
    expect(m.assignee.r_at_3).toBe(true);
  });

  it('assignee R@3 falls back to config default_assignees when ground truth is null', () => {
    const fx = baseFixture({
      ground_truth: { primary_repo: 'KEYPO/keypo-backend', fix_repos: ['KEYPO/keypo-backend'], assignee: null, outcome: 'likely_fixed' },
      labels: ['K5', 'P1_高'],
    });
    const labelConfig = {
      labels: {
        K5: { primary_group: 'KEYPO', default_assignees: ['Joyce'] },
      },
    };
    // Suggested includes Joyce (config) — hit
    const hit = analyzeGap({
      fixture: fx,
      phase1Output: basePhase1({ suggested_assignees: ['Joyce'], suggested_repos: ['KEYPO/keypo-backend'] }),
      phase2Output: null,
      judgeResult: null,
      labelConfig,
    });
    expect(hit.assignee.r_at_3).toBe(true);
    expect(hit.assignee.ground_truth_assignee).toBe('Joyce');
    expect(hit.assignee.ground_truth_source).toBe('config_default');

    // Suggested missing Joyce — miss
    const miss = analyzeGap({
      fixture: fx,
      phase1Output: basePhase1({ suggested_assignees: ['SomeoneElse'], suggested_repos: ['KEYPO/keypo-backend'] }),
      phase2Output: null,
      judgeResult: null,
      labelConfig,
    });
    expect(miss.assignee.r_at_3).toBe(false);
  });

  it('assignee fallback returns 0 when config has no default for the labels', () => {
    const fx = baseFixture({
      ground_truth: { primary_repo: 'bigdata/etl', fix_repos: ['bigdata/etl'], assignee: null, outcome: 'likely_fixed' },
      labels: ['BD'],
    });
    const m = analyzeGap({
      fixture: fx,
      phase1Output: basePhase1({ suggested_assignees: ['anyone'] }),
      phase2Output: null,
      judgeResult: null,
      labelConfig: { labels: { BD: { primary_group: 'bigdata' } } }, // no default_assignees
    });
    expect(m.assignee.r_at_3).toBe(false);
    expect(m.assignee.ground_truth_assignee).toBeNull();
  });

  it('real ground-truth assignee takes precedence over config fallback', () => {
    const fx = baseFixture({
      ground_truth: { primary_repo: 'bigdata/etl', fix_repos: ['bigdata/etl'], assignee: 'nick.huang', outcome: 'likely_fixed' },
      labels: ['K5'],
    });
    const labelConfig = { labels: { K5: { primary_group: 'KEYPO', default_assignees: ['Joyce'] } } };
    const m = analyzeGap({
      fixture: fx,
      phase1Output: basePhase1({ suggested_assignees: ['nick.huang'] }),
      phase2Output: null,
      judgeResult: null,
      labelConfig,
    });
    expect(m.assignee.r_at_3).toBe(true);
    expect(m.assignee.ground_truth_assignee).toBe('nick.huang');
    expect(m.assignee.ground_truth_source).toBe('fixture');
  });

  it('confidence bucket assignment is correct', () => {
    const m = analyzeGap({
      fixture: baseFixture(),
      phase1Output: basePhase1({ confidence: 0.8 }),
      phase2Output: basePhase2(),
      judgeResult: baseJudge(),
    });
    expect(m.confidence.bucket).toBe('0.7-0.9');
    expect(m.confidence.stated).toBe(0.8);
    expect(m.confidence.was_correct).toBe(true);
  });

  it('handles null phase2Output gracefully (low-conf skip)', () => {
    const m = analyzeGap({
      fixture: baseFixture(),
      phase1Output: basePhase1({ confidence: 0.3 }),
      phase2Output: null,
      judgeResult: null,
    });
    expect(m.plan_quality.has_plan_draft).toBe(false);
    expect(m.plan_quality.plan_draft_length).toBe(0);
    expect(m.confidence.bucket).toBe('0.3-0.5');
  });
});

// ---- confidenceBucket -------------------------------------------------------

describe('confidenceBucket', () => {
  it('maps confidences to buckets', () => {
    expect(confidenceBucket(0.1)).toBe('0-0.3');
    expect(confidenceBucket(0.3)).toBe('0.3-0.5');
    expect(confidenceBucket(0.49)).toBe('0.3-0.5');
    expect(confidenceBucket(0.5)).toBe('0.5-0.7');
    expect(confidenceBucket(0.7)).toBe('0.7-0.9');
    expect(confidenceBucket(0.95)).toBe('0.9-1');
  });
});

// ---- aggregate --------------------------------------------------------------

describe('aggregate', () => {
  it('returns zeros for empty array', () => {
    const a = aggregate([]);
    expect(a.n_cases).toBe(0);
    expect(a.p_at_1).toBe(0);
  });

  it('averages P@1 as fraction', () => {
    const metrics = [
      mockMetric({ p_at_1: true }),
      mockMetric({ p_at_1: true }),
      mockMetric({ p_at_1: false }),
      mockMetric({ p_at_1: false }),
    ];
    const a = aggregate(metrics);
    expect(a.p_at_1).toBeCloseTo(0.5);
    expect(a.n_cases).toBe(4);
  });

  it('computes ECE on toy data with known answer', () => {
    // Two buckets. Bucket 0.7-0.9 has avg confidence 0.8 and accuracy 1.0 -> |0.8-1.0|=0.2
    // Bucket 0.3-0.5 has avg confidence 0.4 and accuracy 0.0 -> |0.4-0.0|=0.4
    // Equal weights (2 cases each, 4 total): ECE = (2/4)*0.2 + (2/4)*0.4 = 0.3
    const metrics = [
      mockMetric({ confidence: 0.8, p_at_1: true }),
      mockMetric({ confidence: 0.8, p_at_1: true }),
      mockMetric({ confidence: 0.4, p_at_1: false }),
      mockMetric({ confidence: 0.4, p_at_1: false }),
    ];
    const a = aggregate(metrics);
    expect(a.ece).toBeCloseTo(0.3, 5);
  });

  it('breaks down by label', () => {
    const metrics = [
      mockMetric({ p_at_1: true, labels: ['K5'] }),
      mockMetric({ p_at_1: false, labels: ['K5'] }),
      mockMetric({ p_at_1: true, labels: ['BD'] }),
    ];
    const a = aggregate(metrics);
    expect(a.per_label_breakdown.K5).toBeDefined();
    expect(a.per_label_breakdown.K5.p_at_1).toBeCloseTo(0.5);
    expect(a.per_label_breakdown.BD.p_at_1).toBeCloseTo(1.0);
  });

  it('breaks down by outcome', () => {
    const metrics = [
      mockMetric({ p_at_1: true, outcome: 'likely_fixed' }),
      mockMetric({ p_at_1: false, outcome: 'duplicate' }),
    ];
    const a = aggregate(metrics);
    expect(a.per_outcome_breakdown.likely_fixed.p_at_1).toBeCloseTo(1.0);
    expect(a.per_outcome_breakdown.duplicate.p_at_1).toBeCloseTo(0.0);
  });
});

// ---- runEvalV2 --------------------------------------------------------------

describe('runEvalV2', () => {
  it('partitions fixtures into train/test by splitDate', async () => {
    const fixtures = [
      baseFixture({ id: 'train-1', closed_at: '2026-01-01T00:00:00Z' }),
      baseFixture({ id: 'train-2', closed_at: '2026-02-15T00:00:00Z' }),
      baseFixture({ id: 'test-1', closed_at: '2026-04-01T00:00:00Z' }),
    ];
    const phase1Fn = vi.fn().mockResolvedValue(basePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(basePhase2());
    const judgeFn = vi.fn().mockResolvedValue(baseJudge());

    const result = await runEvalV2({
      fixtures,
      labelConfig: { labels: {} },
      phase1Fn,
      phase2Fn,
      judgeFn,
      splitDate: '2026-03-01T00:00:00Z',
    });

    expect(result.meta.n_train).toBe(2);
    expect(result.meta.n_test).toBe(1);
    expect(result.train_metrics.n_cases).toBe(2);
    expect(result.test_metrics.n_cases).toBe(1);
  });

  it('handles zero fixtures gracefully', async () => {
    const result = await runEvalV2({
      fixtures: [],
      labelConfig: { labels: {} },
      phase1Fn: vi.fn(),
      phase2Fn: vi.fn(),
      judgeFn: vi.fn(),
      splitDate: '2026-03-01T00:00:00Z',
    });
    expect(result.meta.n_train).toBe(0);
    expect(result.meta.n_test).toBe(0);
    expect(result.per_fixture).toEqual([]);
  });

  it('accepts a custom splitFn (stratified by primary_repo)', async () => {
    const mk = (id, repo) =>
      baseFixture({
        id,
        closed_at: '2026-03-01T00:00:00Z',
        ground_truth: { primary_repo: repo, fix_repos: [repo], assignee: 'x', outcome: 'likely_fixed' },
      });
    const fixtures = [
      mk('a1', 'repo-A'), mk('a2', 'repo-A'), mk('a3', 'repo-A'), mk('a4', 'repo-A'),
      mk('b1', 'repo-B'), mk('b2', 'repo-B'), mk('b3', 'repo-B'), mk('b4', 'repo-B'),
    ];

    const splitFn = makeStratifiedSplitByPrimaryRepo(0.75, 1);
    const result = await runEvalV2({
      fixtures,
      labelConfig: { labels: {} },
      phase1Fn: vi.fn().mockResolvedValue(basePhase1()),
      phase2Fn: vi.fn().mockResolvedValue(basePhase2()),
      judgeFn: vi.fn().mockResolvedValue(baseJudge()),
      splitFn,
    });

    expect(result.meta.n_train).toBe(6);
    expect(result.meta.n_test).toBe(2);
    expect(result.meta.split_strategy).toMatch(/stratified_primary_repo/);
    // Both strata must be represented in train; test must also have both.
    const trainRepos = new Set(
      result.per_fixture.filter((r) => r.split === 'train').map((r) => r.fixture_id[0])
    );
    const testRepos = new Set(
      result.per_fixture.filter((r) => r.split === 'test').map((r) => r.fixture_id[0])
    );
    expect(trainRepos.size).toBe(2);
    expect(testRepos.size).toBe(2);
  });

  it('preserves split assignments from an existing run when rerunning select fixtures', async () => {
    // Two fixtures, previously partitioned into train + test by some earlier run.
    // A preserving splitFn must keep them in their original splits.
    const existingPerFixture = [
      { split: 'train', fixture_id: 2860 },
      { split: 'test', fixture_id: 2821 },
      { split: 'test', fixture_id: 2788 },
    ];
    const splitFn = buildPreservingSplitFn(existingPerFixture);

    const fixtures = [
      baseFixture({ id: 2860 }),
      baseFixture({ id: 2821 }),
      baseFixture({ id: 2788 }),
    ];

    const result = await runEvalV2({
      fixtures,
      labelConfig: { labels: {} },
      phase1Fn: vi.fn().mockResolvedValue(basePhase1()),
      phase2Fn: vi.fn().mockResolvedValue(basePhase2()),
      judgeFn: vi.fn().mockResolvedValue(baseJudge()),
      splitFn,
    });

    expect(result.meta.n_train).toBe(1);
    expect(result.meta.n_test).toBe(2);
    expect(result.meta.split_strategy).toMatch(/preserved/);
    const trainIds = result.per_fixture.filter((r) => r.split === 'train').map((r) => r.fixture_id);
    const testIds = result.per_fixture.filter((r) => r.split === 'test').map((r) => r.fixture_id);
    expect(trainIds).toEqual([2860]);
    expect(testIds.sort()).toEqual([2788, 2821]);
  });

  it('skips phase2 when confidence < 0.5', async () => {
    const fixtures = [baseFixture({ closed_at: '2026-01-01T00:00:00Z' })];
    const phase1Fn = vi.fn().mockResolvedValue(basePhase1({ confidence: 0.3 }));
    const phase2Fn = vi.fn().mockResolvedValue(basePhase2());
    const judgeFn = vi.fn().mockResolvedValue(baseJudge());

    await runEvalV2({
      fixtures,
      labelConfig: { labels: {} },
      phase1Fn,
      phase2Fn,
      judgeFn,
      splitDate: '2026-03-01T00:00:00Z',
    });

    expect(phase1Fn).toHaveBeenCalled();
    expect(phase2Fn).not.toHaveBeenCalled();
  });
});

describe('parseRerunArgs', () => {
  it('parses --only-ids and --merge-into', () => {
    const args = parseRerunArgs(['--only-ids', '2821,2788,2774', '--merge-into', 'results/foo.json']);
    expect(args.onlyIds).toEqual([2821, 2788, 2774]);
    expect(args.mergeInto).toBe('results/foo.json');
  });

  it('handles string (non-numeric) ids', () => {
    const args = parseRerunArgs(['--only-ids', 'k5-2821,k5-2788']);
    expect(args.onlyIds).toEqual(['k5-2821', 'k5-2788']);
    expect(args.mergeInto).toBeUndefined();
  });

  it('returns empty onlyIds when flag absent', () => {
    expect(parseRerunArgs(['--other-flag', 'x']).onlyIds).toEqual([]);
  });
});

describe('mergeEvalResults', () => {
  it('replaces per_fixture entries matching rerun ids and re-aggregates both splits', () => {
    // Existing run: 3 fixtures, 1 train (hit), 2 test (both errors).
    const mkEntry = (id, split, hit, error = null) => ({
      split,
      fixture_id: id,
      phase1: hit ? { suggested_repos: ['r1'], suggested_assignees: [], confidence: 0.9, caveats: [] } : null,
      phase2: null,
      judgeResult: hit ? { avg: 4 } : null,
      error,
      metrics: hit
        ? {
            routing: { p_at_1: 1, r_at_3: 1, cross_repo_recall: 1 },
            assignee: { r_at_3: 0 },
            calibration: { confidence: 0.9, bucket: '0.9-1.0', correct: 1 },
            judge: { avg: 4 },
            context: { label: 'K5', outcome: 'likely_fixed' },
          }
        : null,
    });
    const existing = {
      train_metrics: {},
      test_metrics: {},
      per_fixture: [
        mkEntry(100, 'train', true),
        mkEntry(200, 'test', false, 'Phase1 CLI fallback'),
        mkEntry(201, 'test', false, 'Phase1 CLI fallback'),
      ],
      meta: { n_train: 1, n_test: 2, split_strategy: 'stratified_primary_repo' },
    };

    // Rerun replaces the two failed test entries with successful ones.
    const rerun = {
      train_metrics: {},
      test_metrics: {},
      per_fixture: [
        mkEntry(200, 'test', true),
        mkEntry(201, 'test', true),
      ],
      meta: { n_train: 0, n_test: 2, split_strategy: 'preserved_from_prior_run' },
    };

    const merged = mergeEvalResults(existing, rerun);

    // Per-fixture: original 1 train + 2 newly-populated test
    expect(merged.per_fixture).toHaveLength(3);
    const test200 = merged.per_fixture.find((r) => r.fixture_id === 200);
    expect(test200.error).toBeNull();
    expect(test200.metrics).toBeTruthy();

    // Aggregates recomputed: all 2 test cases now hit → P@1 = 1.0
    expect(merged.test_metrics.n_cases).toBe(2);
    expect(merged.test_metrics.p_at_1).toBe(1);
    expect(merged.train_metrics.n_cases).toBe(1);
    expect(merged.meta.n_train).toBe(1);
    expect(merged.meta.n_test).toBe(2);
  });

  it('preserves non-matching existing entries untouched', () => {
    const mkMinimal = (id, split) => ({ split, fixture_id: id, error: 'prior fail', metrics: null });
    const existing = {
      train_metrics: {},
      test_metrics: {},
      per_fixture: [mkMinimal(1, 'train'), mkMinimal(2, 'train')],
      meta: { n_train: 2, n_test: 0 },
    };
    const rerun = {
      train_metrics: {},
      test_metrics: {},
      per_fixture: [{ split: 'train', fixture_id: 1, error: null, metrics: null }],
      meta: { n_train: 1, n_test: 0 },
    };
    const merged = mergeEvalResults(existing, rerun);
    const two = merged.per_fixture.find((r) => r.fixture_id === 2);
    expect(two.error).toBe('prior fail');
  });
});

// ---- judge prompt + parser --------------------------------------------------

describe('buildJudgePrompt', () => {
  it('includes issue title, description (truncated), labels, and plan fields', () => {
    const prompt = buildJudgePrompt({
      issue: {
        title: 'Sample title',
        description: 'A'.repeat(2000),
        labels: ['K5', 'P1_高'],
      },
      phase1Output: basePhase1(),
      phase2Output: basePhase2(),
    });
    expect(prompt).toContain('Sample title');
    expect(prompt).toContain('K5');
    expect(prompt).toContain('suggested_repos');
    expect(prompt).toContain('plan_draft');
    // Description must be truncated to 800 chars
    expect(prompt.length).toBeLessThan(5000);
  });

  it('does NOT include ground truth', () => {
    const prompt = buildJudgePrompt({
      issue: {
        title: 'Title',
        description: 'Desc',
        labels: [],
      },
      phase1Output: basePhase1(),
      phase2Output: basePhase2(),
    });
    expect(prompt).not.toMatch(/ground[_ ]truth/i);
    expect(prompt).not.toMatch(/primary_repo/);
    expect(prompt).not.toMatch(/outcome/);
  });

  it('renders risks when phase2 provides them so judge can score coverage on risk awareness', () => {
    const prompt = buildJudgePrompt({
      issue: { title: 'T', description: 'D', labels: [] },
      phase1Output: basePhase1(),
      phase2Output: basePhase2({
        risks: [
          '修改 export.py 可能影響 Excel / PDF 匯出',
          '需監控 error rate 30 分鐘',
        ],
      }),
    });
    expect(prompt).toContain('risks');
    expect(prompt).toContain('修改 export.py 可能影響');
    expect(prompt).toContain('需監控 error rate');
  });

  it('renders "(none)" for risks when phase2 does not provide them', () => {
    const prompt = buildJudgePrompt({
      issue: { title: 'T', description: 'D', labels: [] },
      phase1Output: basePhase1(),
      phase2Output: basePhase2({ risks: undefined }),
    });
    expect(prompt).toMatch(/risks:\s*\(none/);
  });
});

describe('parseJudgeOutput', () => {
  it('parses plain JSON', () => {
    const raw = JSON.stringify({
      relevance: 5,
      actionability: 4,
      correctness: 3,
      coverage: 4,
      reasoning: 'good',
    });
    const r = parseJudgeOutput(raw);
    expect(r.relevance).toBe(5);
    expect(r.avg).toBeCloseTo((5 + 4 + 3 + 4) / 4);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n' + JSON.stringify({
      relevance: 4, actionability: 4, correctness: 4, coverage: 4, reasoning: 'ok',
    }) + '\n```';
    const r = parseJudgeOutput(raw);
    expect(r.avg).toBeCloseTo(4);
  });

  it('returns error object on malformed output', () => {
    const r = parseJudgeOutput('not json at all { broken');
    expect(r.error).toBe('parse_failure');
    expect(r.raw).toContain('not json');
  });

  it('returns error when required fields missing', () => {
    const r = parseJudgeOutput(JSON.stringify({ relevance: 5 }));
    expect(r.error).toBe('parse_failure');
  });
});

describe('runJudge (with injected exec)', () => {
  it('returns parsed result on success', async () => {
    const fakeExec = vi.fn((cmd, args, opts, cb) => {
      cb(null, JSON.stringify({
        relevance: 5, actionability: 5, correctness: 5, coverage: 5, reasoning: 'excellent',
      }), '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await runJudge({
      issue: { title: 't', description: 'd', labels: [] },
      phase1Output: basePhase1(),
      phase2Output: basePhase2(),
      exec: fakeExec,
    });
    expect(result.avg).toBeCloseTo(5);
  });

  it('returns error object on exec failure (after retry)', async () => {
    const fakeExec = vi.fn((cmd, args, opts, cb) => {
      cb(new Error('boom'), '', 'stderr');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await runJudge({
      issue: { title: 't', description: 'd', labels: [] },
      phase1Output: basePhase1(),
      phase2Output: basePhase2(),
      exec: fakeExec,
      maxRetries: 1,
    });
    expect(result.error).toBeDefined();
    expect(fakeExec).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

// ---- helpers ----------------------------------------------------------------

function mockMetric({ p_at_1 = true, confidence = 0.8, outcome = 'likely_fixed', labels = ['K5'] } = {}) {
  return {
    routing: {
      p_at_1,
      r_at_3: p_at_1,
      cross_repo_recall: p_at_1 ? 1 : 0,
    },
    assignee: {
      r_at_3: true,
      ground_truth_assignee: 'alice',
      suggested: ['alice'],
    },
    confidence: {
      stated: confidence,
      was_correct: p_at_1,
      bucket: confidenceBucket(confidence),
    },
    plan_quality: {
      judge_avg: 4,
      has_plan_draft: true,
      plan_draft_length: 3,
    },
    __fixture_id: 'fx',
    __ground_truth_outcome: outcome,
    __labels: labels,
  };
}
