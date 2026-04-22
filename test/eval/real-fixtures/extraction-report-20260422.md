# Ground Truth Extraction Report — 2026-04-22

## Run Parameters

- Label: `K5`
- Since: `2026-01-01`
- Until: `(none)`
- Limit: 150
- Projects: techcenter/reportcenter, techcenter/reportcenter_confidential
- Output: `test/eval/real-fixtures/`
- LLM mode: `cli`

## Stats

| bucket | count |
|---|---|
| fetched | 135 |
| GOLD (written) | 0 |
| SILVER (written) | 2 |
| BRONZE (not written) | 128 |
| SKIP (duplicate/wont_fix/customer_error) | 5 |
| errors | 0 |

## Outcome Histogram

| outcome | count |
|---|---|
| unclear | 66 |
| likely_fixed | 49 |
| no_fix_needed | 15 |
| customer_error | 2 |
| duplicate | 2 |
| wont_fix | 1 |

## Top 5 fix_repos (validates label config predictions)

| repo | mentions |
|---|---|
| `KEYPO/keypo-engine-api` | 7 |
| `KEYPO/keypo-engine/data-collector` | 4 |
| `KEYPO/keypo-backend` | 2 |
| `KEYPO/keypo-engine/on-premises-api-gateway` | 1 |
| `KEYPO/keypo-q-huaan-v2` | 1 |

## Cost

- LLM calls: 59
- LLM errors: 76
- Input tokens: 0
- Output tokens: 0
- Est. cost (Sonnet 4.6): $0.00

## Known Gaps / TODOs

- Signal 2b (closing-commenter commit heuristic) replaces deprecated signal 2a.
  Validation (2026-04-22, 135 K5 issues) showed signal 2a had 0% agreement
  with signal 1; this team's assignees are CSMs, not fixers. Signal 2b uses
  the last non-bot user comment before close (often the actual fixer).
- Anonymization is conservative; expand blacklist if review surfaces leaked
  customer names.
- CLI fallback path (claude --print) can't force tool_use; we rely on JSON
  output contract instead. If the CLI returns malformed JSON, LLM signal is
  treated as a low-confidence error.