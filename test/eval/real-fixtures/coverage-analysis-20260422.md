# Config Coverage Analysis — 2026-04-22

Zero-cost sanity check: does the current `config/label-routing.yaml` cover the
3 GOLD fixture ground truths? Run without LLM / API calls.

## K5 config as of 2026-04-22

```yaml
K5:
  product: KEYPO
  primary_group: KEYPO
  known_exceptions:
    - llmprojects/keypo-agent
```

## GOLD fixtures

| Fixture | Ground truth primary_repo | Coverage | Issue title |
|---|---|---|---|
| k5-300 | `KEYPO/keypo-backend` | ✅ primary_group | 20260105 - 試用帳號_帳號到期後更新延長的時間前推播了先前設定的速報 |
| k5-302 | `KEYPO/keypo-backend` | ✅ primary_group | 20260106 - 錯誤訊息顯示Unknown error |
| k5-304 | `KEYPO/keypo-engine-api` | ✅ primary_group | 20260108 - 某客戶_聲量有超出100筆的聲量數值,不過AI報告顯示聲量不足... |

## Summary

- **Coverage: 3/3 (100%)** — All GOLD ground truth repos fall within K5's
  `primary_group=KEYPO`. The system's rule-based routing layer (before LLM) would
  correctly identify all 3 as KEYPO-group issues.

- **Ground truth repo distribution** (3 cases, very small sample):
  - `KEYPO/keypo-backend`: 2 hits
  - `KEYPO/keypo-engine-api`: 1 hit

## What this tells us

✅ **Structural config is correct** — no missing exception needed for K5.

✅ **Rule-based routing would never MISS** (all land in KEYPO/*)

⚠️ **LLM-ranking precision unknown** — the question "does phase1 rank
`keypo-backend` into top 3 over other KEYPO repos like `keypo-engine-gateway`,
`keypo-portal-admin`, etc." requires:
1. `ANTHROPIC_API_KEY` set in env (phase1-routing.mjs uses SDK)
2. Real run against the 3 fixtures

## What this does NOT tell us

- Whether phase1 would rank `keypo-backend` first vs 20th of the KEYPO repos
- Whether plan quality (judge rubric) is adequate
- Whether confidence calibration is right (high-conf cases are P@1 correct?)

These need:
- ANTHROPIC_API_KEY in env, OR
- CLI-fallback added to phase1/phase2 modules (non-trivial change to tested code), OR
- User provides API key and we run real Phase II

## TODOs surfaced

1. `KEYPO/keypo-backend` is the most-mentioned repo in GOLD. Consider adding it
   as a known_exception hint to the label-routing.yaml for documentation purposes
   (not strictly needed — primary_group already covers it — but makes the config
   self-documenting for readers).
2. Phase I v1.1: add signal 2 (assignee heuristic) to boost GOLD yield 10-15x.
3. Phase II v1.1: add CLI fallback to phase1/phase2 so real eval runs without
   ANTHROPIC_API_KEY (matches extractor's pattern).

## Relation to overall eval v2 roadmap

- Phase I (ground truth extraction): ✅ DONE with thin yield (3 GOLD)
- **Phase I v1.1** (signal 2): 🟡 HIGH-ROI unblock, not yet implemented
- Phase II scaffold: ✅ DONE (23 tests)
- Phase II real run: 🔒 BLOCKED on API key OR CLI fallback
- Phase III iteration loop: 🔒 blocked by Phase II baseline
- Phase IV cross-label: 🔒 blocked by III
