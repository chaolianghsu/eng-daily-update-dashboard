# Eval v2 — multi-metric, real-fixture, judge-graded

Eval v2 evaluates the issue-routing LLM pipeline (`lib/llm/*`) against **real
ground-truth fixtures** extracted from closed GitLab issues — not synthetic
hand-crafted fixtures. It scores on five metrics (P@1, R@3, cross-repo recall,
assignee R@3, plan quality) plus a calibration check (ECE).

It **coexists** with the legacy synthetic runner (`run-eval.mjs`); neither
replaces the other.

## Files

| File | Purpose |
|------|---------|
| `judge-sonnet.mjs` | Shell-out wrapper around `claude --print --model sonnet-4-5`. Rubric-based JSON scoring. Blind to ground truth. |
| `gap-analyzer.mjs` | `analyzeGap` (per fixture) + `aggregate` (overall + per-label + per-outcome + ECE). |
| `multi-metric-eval.mjs` | `runEvalV2` runner + CLI entry point. Splits train/test by close date. |
| `real-fixtures/*.json` | Ground-truth fixtures written by `scripts/extract-ground-truth.mjs` (separate subagent). Each fixture has `issue`, `similar_issues`, `ground_truth`. |
| `results/eval-YYYYMMDD-HHMM.json` | Full run output (per-fixture + aggregated). |

## Requirements

- `ANTHROPIC_API_KEY` set in env (for `lib/llm/phase1-routing.mjs` + `phase2-plan.mjs`)
- `claude` CLI installed and logged in (used by the judge: `claude --print --model sonnet-4-5`)
- Fixtures present in `test/eval/real-fixtures/`

## Workflow

### 1. Extract ground-truth fixtures

```bash
node scripts/extract-ground-truth.mjs --label K5 --limit 150
```

Writes `test/eval/real-fixtures/*.json`. Each fixture has:

```json
{
  "id": "K5-5020",
  "issue": { "iid": 5020, "title": "...", "description": "...", "labels": [...], "project_path": "...", "closed_at": "2026-03-15T..." },
  "similar_issues": [...],
  "ground_truth": {
    "primary_repo": "bigdata/etl-pipeline",
    "fix_repos": ["bigdata/etl-pipeline", "infra/monitoring"],
    "assignee": "nick.huang",
    "outcome": "likely_fixed"
  }
}
```

### 2. Review fixtures

```bash
ls test/eval/real-fixtures/
jq '.ground_truth' test/eval/real-fixtures/K5-5020.json
```

### 3. Run eval v2

```bash
node test/eval/multi-metric-eval.mjs
```

This will:

1. Load all fixtures from `test/eval/real-fixtures/`.
2. Split 70/30 by `issue.closed_at` (earlier = train, later = test).
3. For each fixture, run `runPhase1Routing` → (gated on confidence ≥ 0.5) `runPhase2Plan` → `runJudge`.
4. Compute per-fixture metrics + aggregate per split.
5. Print a summary table to stdout.
6. Write full JSON to `test/eval/results/eval-YYYYMMDD-HHMM.json`.

### 4. Read results

**Summary table (stdout):**

```
=== EVAL v2 SUMMARY ===
Split date: 2026-03-01T...
n_train: 105   n_test: 45

Metric               |  Train  |   Test
---------------------|---------|---------
P@1                  |  0.720  |  0.689
R@3                  |  0.895  |  0.867
Cross-repo recall    |  0.634  |  0.601
Assignee R@3         |  0.553  |  0.524
ECE                  |  0.084  |  0.112
Judge avg            |  3.820  |  3.750
```

**Full JSON (`results/eval-*.json`):**

```json
{
  "train_metrics": { "n_cases": 105, "p_at_1": 0.72, "r_at_3": 0.895, ..., "per_label_breakdown": {...}, "per_outcome_breakdown": {...} },
  "test_metrics":  { ... },
  "per_fixture":   [ { "split": "train", "fixture_id": "K5-5020", "phase1": {...}, "phase2": {...}, "judgeResult": {...}, "metrics": {...} }, ... ],
  "meta":          { "n_train": 105, "n_test": 45, "split_date": "...", "run_started_at": "...", "run_finished_at": "..." }
}
```

## Metrics

| Metric | Definition |
|--------|-----------|
| **P@1** | Top suggested repo equals `ground_truth.primary_repo`. |
| **R@3** | Any of `ground_truth.{primary_repo, fix_repos}` is in top 3 suggestions. |
| **Cross-repo recall** | Fraction of `ground_truth.fix_repos` present anywhere in `suggested_repos`. |
| **Assignee R@3** | `ground_truth.assignee` is in top 3 `suggested_assignees`. |
| **ECE** | Expected Calibration Error: Σ\_bucket (|B|/N) · \|avg_conf − accuracy\|. Lower is better. |
| **Judge avg** | Mean of the four 1–5 rubric scores (relevance, actionability, correctness, coverage) from `claude sonnet-4-5`. |

## Iterating

Typical workflow to improve the pipeline:

1. Run the baseline eval. Save `results/eval-baseline.json`.
2. Read `per_fixture[].metrics` for the lowest-scoring cases. Look at Phase 1 output.
3. Edit prompts in `lib/llm/phase1-routing.mjs` or `lib/llm/phase2-plan.mjs`.
4. Re-run eval. Diff the new `results/eval-*.json` against the baseline.
5. If `test_metrics.p_at_1` improved without `test_metrics.ece` getting worse, ship.

## Judge details

- **Model**: `claude sonnet-4-5` (via Claude CLI, reuses user auth — no API key needed for the judge specifically).
- **Timeout**: 60s per call.
- **Retries**: 1 (so up to 2 attempts).
- **Blind to ground truth**: the judge prompt includes only the issue + the plan. It scores on its own merits.
- **Parse failures** are captured as `{ error, raw }` and don't crash the run.

## What this runner does NOT do

- It doesn't modify the legacy `run-eval.mjs` runner or its synthetic fixtures —
  they still pass under the old 90%-threshold gate.
- It doesn't persist cost/token counts (`meta.total_cost_usd_estimate` is a
  placeholder for a future pass).
- It doesn't retry transient Phase 1/Phase 2 failures — those bubble up and the
  fixture is recorded with `error` instead of `metrics`.
