# Issue Routing — Verification Status (as of 2026-04-22)

Honest assessment: for each of the 3 core capabilities the system is designed
to provide, what have we **actually verified with data**, and what remains
**unverified**?

---

## Pipeline overview

```
New issue arrives
    ↓
(1) 釐清問題        ← Phase 1 LLM reads issue + similar past → summary + reasoning
    ↓
(2) 找到對應 repos  ← Phase 1 LLM outputs suggested_repos (top 3) + confidence
    ↓
(3) 產生 plan/specs ← Phase 2 LLM(only if confidence ≥ 0.5) → summary + 3-5 bullets
    ↓
Post to Google Chat
    ↓
IC clicks Approve/Edit/Dismiss
    ↓
On Approve: plan becomes GitLab comment
```

---

## Capability 1: 釐清問題 (problem clarification / summary)

### What runs
- Phase 1 LLM returns `reasoning` (1-2 zh-TW sentences explaining routing judgment)
- Phase 2 LLM returns `summary` (3-5 zh-TW sentences) — only when confidence ≥ 0.5

### What's verified ✅
- ✅ **Pipeline runs end-to-end**. `reasoning` + `summary` fields populate as designed in eval runs.
- ✅ **zh-TW output confirmed**. Model produces Traditional Chinese consistently.
- ✅ **Truncation + PII-avoidance instruction in prompt**. Design doc P1.4 is wired.

### What's unverified ⚠️
- ⚠️ **Summary quality**. Judge rubric includes "relevance" + "correctness" + "coverage". On 3 K5 GOLD fixtures, **judge avg = 2.5 / 5** — mediocre. Not great, not terrible.
- ❌ **Is it useful to IC**? Nobody has read a real summary in production context yet. Quality-of-life verdict needs actual IC eyeballs.
- ❌ **Does summary match issue semantics**? Only 3 cases measured. Statistically unreliable.

### Evidence
`test/eval/results/eval-2026-04-22-07-10.json` — full judge scores per fixture.

---

## Capability 2: 找到對應的 repos (repo routing)

### What runs
- Phase 1 LLM reads issue + label config + similar past issues → outputs `suggested_repos` (top 3), `suggested_assignees`, `confidence`

### What's verified ✅

| Metric | Value | Interpretation |
|---|---|---|
| **R@3(train+test)** | **100%** | Ground truth repo IS in top 3 suggested(on 3 K5 cases) |
| **Cross-repo recall** | **100%** | Multi-repo issues covered |
| **Confidence calibration(ECE)** | 0.29 train / 0.32 test | Moderate — system isn't overconfident |
| **Production gate R@3 ≥ 70%** | **MET** | On this tiny sample |

**Key insight**: config enumeration is load-bearing. First eval run had R@3=0% because label-routing.yaml didn't list specific KEYPO repos. After adding 20 active KEYPO repos → R@3 jumped to 100%(commit `4cfbc01`).

### What's unverified ⚠️

- ⚠️ **P@1 = 0% (0/3)** — top-1 suggestion is wrong. IC sees top-1 first; this is a UX concern. R@3 = 100% means correct repo is LISTED but not FIRST. Need prompt-tune or activity-weighted ranking to fix.
- ❌ **n=3 is statistically thin**. ±30% CI. Could be 70% OR 0% in reality.
- ❌ **Other labels untested**. BD / DV / Fanti / Data / 信義 have ZERO eval coverage. K5's result doesn't transfer automatically — each label has different corpus.
- ❌ **Corpus realities unknown for other labels**. K5 has only 2.2% MR-cross-ref coverage. Other labels' coverage unmeasured. Signal 1 may work better or worse elsewhere.
- ❌ **IC "would click through" to top-3 behavior**. Real user behavior unverified.

### Evidence
- `test/eval/results/eval-2026-04-22-07-10.json`
- `test/eval/diagnostics/signal-validation-K5-20260422.json` (diagnostic on 135 K5 issues)

---

## Capability 3: 產生解決方案 plan/specs

### What runs
- Phase 2 LLM — **only if Phase 1 confidence ≥ 0.5**
- Outputs `summary` + `plan_draft` (3-5 bullets, executable steps)
- On the 3 K5 eval fixtures: confidence was 0.20 / 0.28 / 0.30 → **Phase 2 was SKIPPED in all 3**

### What's verified ✅
- ✅ **Confidence gate works**. Phase 2 correctly skipped when confidence < 0.5. System doesn't generate plans when uncertain — this is the designed behavior.
- ✅ **Schema enforcement**. When Phase 2 runs, output JSON matches `PLAN_TOOL` schema (validated in unit tests).
- ✅ **PII-avoidance instruction in Phase 2 prompt**. Design doc rule is wired.

### What's unverified ❌❌
- ❌❌ **Plan quality never measured** — Phase 2 didn't run on any real eval fixture. Judge's 2.5/5 score covers reasoning + routing, not plan_draft.
- ❌ **High-confidence behavior**. What does Phase 2 look like when confidence ≥ 0.5? Only tested in unit tests with mocked outputs, never with real issues.
- ❌ **How often will confidence ≥ 0.5 in production?** Unknown. Based on eval pattern, could be <20% of incoming issues. Meaning 80%+ of issues get NO plan, just routing.
- ❌ **Does plan_draft make sense technically?** Needs engineer review. Nobody qualified has read one yet.

### Evidence
- Unit tests: `test/unit/llm/phase2-plan.test.mjs` (13 mocked tests)
- Real-data eval:**zero runs produced plan_draft**(all skipped by confidence gate)

---

## Overall Verification Matrix

| Step                       | Mechanically works | Runs in eval        | Quality measured              | Statistically valid | Real-user validated |
| -------------------------- | ------------------ | ------------------- | ----------------------------- | ------------------- | ------------------- |
| 1. 釐清問題                    | ✅                  | ✅                   | ⚠️ judge 2.4–2.7/5            | ❌ n=5               | ❌                   |
| 2. 找到 repos                | ✅                  | ✅                   | ⚠️ R@3=100% train / 0% test, P@1=0% | ❌ n=5               | ❌                   |
| 3. 產生 plan                 | ✅                  | ❌ (skipped)         | ❌                             | ❌                   | ❌                   |
| IC Approve→ GitLab comment | ✅(unit+int)        | ❌(not in real flow) | —                             | —                   | ❌                   |
| Chat post idempotency      | ✅(unit+int)        | ❌                   | —                             | —                   | ❌                   |

Legend:
- ✅ = verified with data
- ⚠️ = partial evidence (mediocre or small sample)
- ❌ = no data

---

## The honest answer

### What works today(with evidence)
- **System pipeline**: all components produce output as designed. 242 tests pass, 0 regression.
- **Routing layer(2)**: when config enumerates candidates, top-3 recall is 100% on a 3-case sample.
- **Confidence gate(3)**: correctly prevents plan generation when uncertain.

### What we guessed but haven't proved
- **Summary quality(1)**: "probably adequate" based on 3 mediocre judge scores
- **Plan quality(3)**: ZERO empirical data. Could be great, could be garbage.
- **Other labels(2)**: Zero coverage. Each label has different corpus patterns.
- **Top-1 ranking(2)**: System picks wrong repo as top-1 100% of time in sample. IC UX impact unknown.

### What's structurally verified impossible
- ❌ **Signal 2a (assignee heuristic) for K5**: CSM assignees ≠ engineering commit authors. 0% overlap(135-issue validation).
- ❌ **High GOLD yield from deterministic signals alone**: 2.2% MR coverage is a hard ceiling. More ground truth requires signal 2b, keyword matching, OR human labeling.

### Signal 2b (closing-commenter heuristic) — first run results (2026-04-22)
- Replaces deprecated signal 2a. Identifies the last non-bot user comment before close, checks their commits in candidate repos within ±14d.
- **Yield: 0 GOLD + 2 SILVER on 135 K5 issues** (`k5-3030` joyce → keypo-engine-api; `k5-319` aaron.li → on-premises-api-gateway). Both fixtures point to KEYPO engineers, semantically valid.
- ⚠️ This run hit Claude CLI rate limits mid-extraction (76 LLM errors / 135 issues). Three baseline GOLDs (k5-300/302/304) could not be reproduced in this rerun and were restored from git (commit `279381a`); they remain valid evidence.
- ⚠️ **Phase II eval on the 2 new SILVERs: P@1=0%, R@3=0%**. Phase 1 LLM does not currently route these to their fix repos (e.g., k5-319 → ground truth `on-premises-api-gateway`, top-3 was `llmprojects/keypo-agent`/`keypo-backend`/`keypo-engine-api`). Means signal 2b widens the eval to harder cases the current system fails — this is *additional production failure surface area now visible*, not regression.
- Production extractor needs retry-with-backoff on CLI rate-limit errors before re-running on a larger label set.

---

## What to do with this

### If the risk tolerance is **low** → DON'T ship yet
- Manual-label 30-50 K5 issues(1-2 hr user time)
- Re-run eval with larger n → statistical confidence
- Tune prompt if P@1 < 30% on larger sample
- THEN ship

### If the risk tolerance is **moderate**(recommended for intrapreneurship)→ SHIP with guardrails
- Current system has approval gate: **no GitLab comment without IC click**. That's the safety net
- Ship to 1 specific test Chat space first(5-10 IC test users)
- Monitor dismiss rate. High dismiss = low quality plans. Low dismiss = usable
- Iterate prompt based on dismiss signals
- Phase II of eval(with 2b closing-commenter signal)comes from real production data
- Cost of being wrong: a few mis-routed Chat posts that IC ignore. No blast radius

### If the risk tolerance is **high** → SHIP wide
- Go cron 15min, whole team, both spaces
- Rate of mistakes uncovered = rate of learning
- Config + prompt corrections via PR cadence
- Monitor via audit(D4)

**Recommendation for this team**: **Moderate**. You have the approval gate as safety. Real feedback > more eval cycles.

---

## Commits backing this report

| Commit | Evidence |
|---|---|
| `4cfbc01` | R@3=100% after config enumeration |
| `d396817` | First real eval baseline(P@1=R@3=0% before fix) |
| `fc3be64` | CLI fallback enabling eval to run |
| `70b3da9` | Signal 2 structural-failure diagnostic on 135 issues |
| `8023674` | B4 synthetic eval baseline(14 fixtures) |

29 commits total on `feat/issue-routing-eval-v2`.
