# Ground Truth Extraction Report — 2026-04-23

## Run Parameters

- Label: `K5`
- Since: `2025-10-01`
- Until: `(none)`
- Limit: 300
- Projects: techcenter/reportcenter, techcenter/reportcenter_confidential
- Output: `tmp/k5-rerun-b2b/`
- LLM mode: `cli`

## Stats

| bucket | count |
|---|---|
| fetched | 283 |
| GOLD (written) | 15 |
| SILVER (written) | 16 |
| BRONZE (not written) | 230 |
| SKIP (duplicate/wont_fix/customer_error) | 22 |
| errors | 0 |

## Outcome Histogram

| outcome | count |
|---|---|
| likely_fixed | 176 |
| no_fix_needed | 66 |
| unclear | 19 |
| customer_error | 8 |
| duplicate | 8 |
| wont_fix | 6 |

## Top 5 fix_repos (validates label config predictions)

| repo | mentions |
|---|---|
| `CrawlersV2/bigcrawler-scrapy` | 18 |
| `KEYPO/keypo-engine-api` | 13 |
| `KEYPO/keypo-backend` | 9 |
| `llmprojects/keypo-agent` | 6 |
| `KEYPO/keypo-engine/data-collector` | 5 |

## Cost

- LLM calls: 283
- LLM errors: 0
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