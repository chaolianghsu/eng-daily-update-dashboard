// test/unit/eval-v2-scaffold.test.mjs — unit tests for Eval v2 Phase II scaffold.
// Covers pure logic: gap analyzer, aggregator (ECE), runner partition, judge prompt + parser.
// All LLM / phase fns / judge are mocked.

import { describe, it, expect, vi } from 'vitest';
import {
  analyzeGap,
  aggregate,
  confidenceBucket,
} from '../../test/eval/gap-analyzer.mjs';
import { runEvalV2, makeStratifiedSplitByPrimaryRepo } from '../../test/eval/multi-metric-eval.mjs';
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
