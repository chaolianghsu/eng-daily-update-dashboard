# Signal 2 Validation Report — K5

Date: 2026-04-22
Source: `scripts/validate-signal-2.mjs`

## Aggregate

| Metric | Count | % |
|---|---|---|
| Total K5 closed issues (Jan 1+) | 135 | 100% |
| Signal 1 (MR cross-ref) fires | 3 | 2.2% |
| Signal 2 (assignee commits ±3d) fires | 2 | 1.5% |
| **Both fire** | **0** | **0.0%** |
| Both fire AND agree on ≥1 repo | 0 | 0.0% |
| Only signal 1 | 3 | 2.2% |
| Only signal 2 | 2 | 1.5% |
| Neither | 130 | 96.3% |

## 🚨 Critical Finding: Signal 2 Is Structurally Broken for This Team

Assignee heuristic assumed **"assignee = person who fixes = person who commits"**. In this team's workflow that assumption is wrong.

### Who are K5 issue assignees?

Unique assignees across 135 K5 closed issues:
```
Alyssa, EddieWang, Ivyma, JennyLee, allen, berry.shih, betsy.chang,
byron.you, clara.chung, joanne.lin, joe, joyce, leamon.lee, neil.chang,
richard.lee, sabinesabine, sylvia.wu, tanya.kang, ted.juang, walt.peng, wendyHsieh
```

### Who commits to K5 repos?

Top KEYPO/* authors (~15 unique across 20 repos):
```
chaoliang.hsu(user), byron.you, jason.liu, ivywang, joe, joyce,
aaron.li, yuriy.lin, walt.peng, sabinesabine, ...
```

### The gap

- Assignees are **1st-line support / CSM** (Ivyma = Ivy's CSM account, Alyssa, joanne.lin, betsy.chang, clara.chung, etc.) — they own TRIAGE, not FIX
- Commit authors are **engineers** who write code
- Overlap is tiny:`byron.you`, `joe`, `joyce`, `walt.peng`. Most issues have assignees in group 1 only

So `assignee.commits_in_±3d` is near-zero **by design**,不是 bug。

## Implications

1. Signal 2 as currently designed (assignee heuristic) **cannot work for this team**. Not fixable by better name matching — the assignee is genuinely not the fixer
2. The "2/3 signals agree → GOLD" promotion rule effectively reduces to **"signal 1 + signal 3 agree"** for K5. Given signal 1 ~2.2% and signal 3 non-deterministic, GOLD ceiling is ~3-10 per 135

## Viable alternatives to signal 2

### 2b: Closing commenter's commits
Not the assignee — the USER who wrote closing comment (e.g. `jason.liu: 已修正請測試`). Parse issue notes → find last non-bot user before close → check their commits. Expected hit rate: 30-50% (closing commenter IS often the fixer).

### 2c: Issue's `closed_by`
GitLab exposes `closed_by`. Sometimes the engineer, often null/CSM. Quick to try, low gain.

### 2d: Repo activity spike
Skip authors. Ask: "In ±3d of close, which K5 repo had abnormal commit volume vs baseline?" Author-independent.

### 2e: Keyword commit matching
Extract title keywords, check all K5 commit messages in window. Noisy but workflow-independent.

## Recommendation

**Don't invest in signal 2a (assignee) v2** — structurally can't work. If eval data is still the bottleneck after shipping, try **2b (closing commenter)** — highest expected yield with small implementation cost.

For now: **3 GOLD fixtures from signal 1 are the eval dataset**. Accept this constraint. Ship; use real IC feedback post-launch to accumulate ground truth organically.

## Script reusability

`scripts/validate-signal-2.mjs` is standalone diagnostic. Re-run any time `label-routing.yaml` changes or to validate other labels (BD/DV/Fanti would need new candidate lists — parametric --label arg is future work).

## Full data

`test/eval/diagnostics/signal-validation-K5-20260422.json` — all 135 issues with per-issue signal breakdown.
