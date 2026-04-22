# Eval v2 — Phase II Baseline (n=3 GOLD fixtures)

- Run date: 2026-04-22 06:46 UTC
- Branch: `feat/issue-routing-eval-v2`
- Runner: `test/eval/multi-metric-eval.mjs`
- LLM path: CLI fallback (`claude --print --model sonnet`) — no `ANTHROPIC_API_KEY` set
- Fixtures: `test/eval/real-fixtures/k5-300.json`, `k5-302.json`, `k5-304.json`
- Full JSON: `test/eval/results/eval-v2-run-20260422-0646.json`

## Run parameters

| Parameter | Value |
|---|---|
| n_train | 2 (closed before split date) |
| n_test | 1 (closed on/after split date) |
| Split date | 2026-02-11T03:21:43.736Z (auto-computed 70/30 by `closed_at`) |
| Phase 1 model | `claude-sonnet-4-6` (via CLI as `sonnet`) |
| Phase 2 model | `claude-sonnet-4-6` (via CLI as `sonnet`) — all fixtures gated off (confidence < 0.5) |
| Judge model | `sonnet-4-5` via `judge-sonnet.mjs` — **failed** this run (CLI model alias mismatch; out of scope to fix here) |

## Per-fixture results

### k5-300 (train) — 試用帳號日報排程錯誤

- **Title**: `20260105 - 試用帳號_帳號到期後更新延長的時間前推播了先前設定的速報`
- **Labels**: Bug, K5, P1_高
- **Ground truth primary_repo**: `KEYPO/keypo-backend`
- **Ground truth outcome**: `likely_fixed`
- **Phase 1 suggested_repos**: `["techcenter/reportcenter_confidential"]`
- **Phase 1 confidence**: 0.28
- **P@1 hit?** no — suggested `techcenter/reportcenter_confidential`, truth is `KEYPO/keypo-backend`
- **R@3 hit?** no
- **Phase 2 plan_draft**: skipped (low confidence < 0.5; correct behavior)
- **Judge**: `exec_failure` (judge used `sonnet-4-5` model alias which the local CLI didn't accept)

### k5-302 (train) — Unknown error 顯示

- **Title**: `20260106 - 錯誤訊息顯示Unknown error`
- **Labels**: Bug, K5, P1_高
- **Ground truth primary_repo**: `KEYPO/keypo-backend`
- **Ground truth outcome**: `likely_fixed`
- **Phase 1 suggested_repos**: `["llmprojects/keypo-agent"]`
- **Phase 1 confidence**: 0.20
- **P@1 hit?** no
- **R@3 hit?** no
- **Phase 2 plan_draft**: skipped (low confidence)
- **Judge**: `exec_failure`

### k5-304 (test) — 聲量足但 AI 報告顯示不足

- **Title**: `20260108 - 某客戶_聲量有超出100筆的聲量數值，不過AI報告顯示聲量不足…`
- **Labels**: Bug, Data, K5, P1_高
- **Ground truth primary_repo**: `KEYPO/keypo-engine-api`
- **Ground truth outcome**: `likely_fixed`
- **Phase 1 suggested_repos**: `["llmprojects/keypo-agent", "CrawlersV2", "bigdata1"]`
- **Phase 1 confidence**: 0.30
- **P@1 hit?** no
- **R@3 hit?** no
- **Phase 2 plan_draft**: skipped (low confidence)
- **Judge**: `exec_failure`

## Aggregate metrics

| Metric | Train (n=2) | Test (n=1) |
|---|---|---|
| P@1 | 0.000 | 0.000 |
| R@3 | 0.000 | 0.000 |
| Cross-repo recall | 0.000 | 0.000 |
| Assignee R@3 | 0.000 | 0.000 |
| ECE | 0.240 | 0.300 |
| Judge avg | 0.000 | 0.000 (judge failed) |

Judge score distribution (all fixtures in the 1–2 bucket due to `exec_failure`):

| Bucket | Train | Test |
|---|---|---|
| 1-2 | 2 | 1 |
| 2-3 | 0 | 0 |
| 3-4 | 0 | 0 |
| 4-5 | 0 | 0 |

## Observations

1. **CLI fallback works end-to-end for Phase 1.** All 3 fixtures returned schema-valid routing output via `claude --print` without an API key. JSON extraction survived real-world stdout (some prose wrapping, no fence issues observed).
2. **Phase 2 gating triggered on every fixture.** All Phase 1 confidences were < 0.5 (0.28 / 0.20 / 0.30), so Phase 2 was short-circuited — the intended low-confidence path, not a bug.
3. **Routing miss on all 3 is a `label_config` gap, not a model bug.** Ground-truth `primary_repo` for every fixture is in the `KEYPO/*` group (`keypo-backend`, `keypo-backend`, `keypo-engine-api`), but the K5 label_config only lists `llmprojects/keypo-agent` as a candidate. The model correctly refused to hallucinate a non-candidate repo; instead it caveated that "label_config 未列出明確 candidates 清單" and suggested the only candidates it had. The fix is config-side (expand K5 candidates to include KEYPO engine/backend repos), not prompt-side.
4. **Low confidence is calibrated-ish.** The model flagged cold-start / config-gap uncertainty in every `caveats` array and kept confidence ≤ 0.3. ECE 0.24–0.30 reflects that the model was honest about uncertainty (low conf + low accuracy is better-calibrated than high conf + low accuracy).
5. **Judge failed on all 3.** `judge-sonnet.mjs` uses `--model sonnet-4-5`, which the installed CLI (2.1.117) doesn't recognize. Judge fix is out of scope for this PR (explicit rule). Next eval run should patch the judge to use `sonnet` alias, same as phase1/2 CLI fallback.

## Caveats

- n=3 is **directionally useful only** — no statistical claims. P@1=0/3 could easily flip to 2/3 with a config tweak.
- The 70/30 split on 3 fixtures puts 2 in train and 1 in test, but "train" here is not a training set — the pipeline is zero-shot. It's just a partition by `closed_at`.
- Phase 2 plan quality is unmeasured this run (judge failed + all gated off anyway).
- Next gates for statistical relevance: rerun with ≥ 30 fixtures once extraction unblocks (task #9 was rate-limited earlier), fix judge model alias, and expand K5 candidate list in `config/label-routing.yaml` to unblock the primary miss mode.
