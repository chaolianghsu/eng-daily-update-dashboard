// test/eval/gap-analyzer.mjs — compare ground_truth vs phase1/phase2 vs judge,
// producing per-fixture metrics + aggregation (ECE, per-label, per-outcome breakdowns).
//
// See design doc "Eval v2 Phase II" (in progress) for context.

/**
 * Analyze the gap between ground_truth and the pipeline's output for one fixture.
 *
 * @param {object} params
 * @param {object} params.fixture - { id, issue, ground_truth: { primary_repo, fix_repos, assignee, outcome } }
 * @param {object} params.phase1Output - phase 1 routing output
 * @param {object|null} params.phase2Output - phase 2 plan or null (low-conf skip)
 * @param {object|null} params.judgeResult - judge output or null/error
 * @returns {object} per-fixture metrics
 */
export function analyzeGap({ fixture, phase1Output, phase2Output, judgeResult }) {
  const gt = fixture?.ground_truth ?? {};
  const primaryRepo = gt.primary_repo ?? null;
  const fixRepos = Array.isArray(gt.fix_repos) ? gt.fix_repos : [];
  const gtAssignee = gt.assignee ?? null;

  const suggested = Array.isArray(phase1Output?.suggested_repos) ? phase1Output.suggested_repos : [];
  const suggestedAssignees = Array.isArray(phase1Output?.suggested_assignees)
    ? phase1Output.suggested_assignees
    : [];

  const top3 = suggested.slice(0, 3);
  const p_at_1 = Boolean(primaryRepo && suggested.length > 0 && suggested[0] === primaryRepo);
  const r_at_3 =
    top3.some((r) => r === primaryRepo) ||
    fixRepos.some((r) => top3.includes(r));

  let cross_repo_recall = 0;
  if (fixRepos.length > 0) {
    const suggestedSet = new Set(suggested);
    const hits = fixRepos.filter((r) => suggestedSet.has(r)).length;
    cross_repo_recall = hits / fixRepos.length;
  }

  const assigneeTop3 = suggestedAssignees.slice(0, 3);
  const assignee_r_at_3 = Boolean(gtAssignee && assigneeTop3.includes(gtAssignee));

  const conf = typeof phase1Output?.confidence === 'number' ? phase1Output.confidence : 0;

  const planDraft = Array.isArray(phase2Output?.plan_draft) ? phase2Output.plan_draft : [];
  const has_plan_draft = planDraft.length > 0;

  const judgeAvg =
    judgeResult && !judgeResult.error && typeof judgeResult.avg === 'number'
      ? judgeResult.avg
      : 0;

  const labels = Array.isArray(fixture?.issue?.labels) ? fixture.issue.labels : [];

  return {
    routing: {
      p_at_1,
      r_at_3,
      cross_repo_recall,
    },
    assignee: {
      r_at_3: assignee_r_at_3,
      ground_truth_assignee: gtAssignee,
      suggested: suggestedAssignees,
    },
    confidence: {
      stated: conf,
      was_correct: p_at_1,
      bucket: confidenceBucket(conf),
    },
    plan_quality: {
      judge_avg: judgeAvg,
      has_plan_draft,
      plan_draft_length: planDraft.length,
    },
    __fixture_id: fixture?.id ?? fixture?.issue?.iid ?? null,
    __ground_truth_outcome: gt.outcome ?? 'unknown',
    __labels: labels,
  };
}

/**
 * Bucket a confidence score [0, 1] into a string label.
 * Buckets: [0, 0.3) [0.3, 0.5) [0.5, 0.7) [0.7, 0.9) [0.9, 1].
 * @param {number} conf
 */
export function confidenceBucket(conf) {
  if (typeof conf !== 'number' || Number.isNaN(conf)) return '0-0.3';
  if (conf < 0.3) return '0-0.3';
  if (conf < 0.5) return '0.3-0.5';
  if (conf < 0.7) return '0.5-0.7';
  if (conf < 0.9) return '0.7-0.9';
  return '0.9-1';
}

/**
 * Aggregate an array of per-fixture metrics into overall stats.
 *
 * ECE = sum_b (|B_b| / N) * |avg_confidence_b - accuracy_b|
 *
 * @param {object[]} metrics
 * @returns {object}
 */
export function aggregate(metrics) {
  const n = Array.isArray(metrics) ? metrics.length : 0;
  if (n === 0) {
    return {
      n_cases: 0,
      p_at_1: 0,
      r_at_3: 0,
      cross_repo_recall_avg: 0,
      assignee_r_at_3: 0,
      ece: 0,
      judge_avg: 0,
      judge_distribution: { '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 },
      per_label_breakdown: {},
      per_outcome_breakdown: {},
    };
  }

  const p_at_1 = mean(metrics.map((m) => (m.routing?.p_at_1 ? 1 : 0)));
  const r_at_3 = mean(metrics.map((m) => (m.routing?.r_at_3 ? 1 : 0)));
  const cross_repo_recall_avg = mean(metrics.map((m) => m.routing?.cross_repo_recall ?? 0));
  const assignee_r_at_3 = mean(metrics.map((m) => (m.assignee?.r_at_3 ? 1 : 0)));
  const judge_avg = mean(metrics.map((m) => m.plan_quality?.judge_avg ?? 0));

  // Judge distribution
  const judge_distribution = { '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 };
  for (const m of metrics) {
    const a = m.plan_quality?.judge_avg ?? 0;
    if (a < 2) judge_distribution['1-2']++;
    else if (a < 3) judge_distribution['2-3']++;
    else if (a < 4) judge_distribution['3-4']++;
    else judge_distribution['4-5']++;
  }

  // ECE: bucket by confidence, weighted mean of |avg_conf - accuracy|
  const buckets = new Map();
  for (const m of metrics) {
    const b = m.confidence?.bucket ?? '0-0.3';
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(m);
  }
  let ece = 0;
  for (const [, members] of buckets.entries()) {
    const avgConf = mean(members.map((x) => x.confidence?.stated ?? 0));
    const accuracy = mean(members.map((x) => (x.routing?.p_at_1 ? 1 : 0)));
    const weight = members.length / n;
    ece += weight * Math.abs(avgConf - accuracy);
  }

  // Per-label breakdown
  const per_label_breakdown = {};
  const labelGroups = new Map();
  for (const m of metrics) {
    for (const lbl of m.__labels ?? []) {
      if (!labelGroups.has(lbl)) labelGroups.set(lbl, []);
      labelGroups.get(lbl).push(m);
    }
  }
  for (const [lbl, members] of labelGroups.entries()) {
    per_label_breakdown[lbl] = {
      n_cases: members.length,
      p_at_1: mean(members.map((m) => (m.routing?.p_at_1 ? 1 : 0))),
      r_at_3: mean(members.map((m) => (m.routing?.r_at_3 ? 1 : 0))),
      assignee_r_at_3: mean(members.map((m) => (m.assignee?.r_at_3 ? 1 : 0))),
      judge_avg: mean(members.map((m) => m.plan_quality?.judge_avg ?? 0)),
    };
  }

  // Per-outcome breakdown
  const per_outcome_breakdown = {};
  const outcomeGroups = new Map();
  for (const m of metrics) {
    const o = m.__ground_truth_outcome ?? 'unknown';
    if (!outcomeGroups.has(o)) outcomeGroups.set(o, []);
    outcomeGroups.get(o).push(m);
  }
  for (const [o, members] of outcomeGroups.entries()) {
    per_outcome_breakdown[o] = {
      n_cases: members.length,
      p_at_1: mean(members.map((m) => (m.routing?.p_at_1 ? 1 : 0))),
      r_at_3: mean(members.map((m) => (m.routing?.r_at_3 ? 1 : 0))),
      judge_avg: mean(members.map((m) => m.plan_quality?.judge_avg ?? 0)),
    };
  }

  return {
    n_cases: n,
    p_at_1,
    r_at_3,
    cross_repo_recall_avg,
    assignee_r_at_3,
    ece,
    judge_avg,
    judge_distribution,
    per_label_breakdown,
    per_outcome_breakdown,
  };
}

// ---- helpers ----------------------------------------------------------------

function mean(xs) {
  if (!xs || xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += Number(x) || 0;
  return s / xs.length;
}
