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
| GOLD (written) | 3 |
| SILVER (written) | 1 |
| BRONZE (not written) | 125 |
| SKIP (duplicate/wont_fix/customer_error) | 6 |
| errors | 0 |

## Outcome Histogram

| outcome | count |
|---|---|
| likely_fixed | 88 |
| no_fix_needed | 30 |
| unclear | 11 |
| wont_fix | 3 |
| customer_error | 2 |
| duplicate | 1 |

## Top 5 fix_repos (validates label config predictions)

| repo | mentions |
|---|---|
| `techcenter/reportcenter` | 3 |
| `llmprojects/keypo-agent` | 2 |
| `KEYPO/keypo-backend` | 2 |
| `techcenter/reportcenter_confidential` | 1 |
| `KEYPO/keypo-engine-api` | 1 |

## Cost

- LLM calls: 134
- LLM errors: 1
- Input tokens: 0
- Output tokens: 0
- Est. cost (Sonnet 4.6): $0.00

## Known Gaps / TODOs

- Assignee heuristic (signal 2) **disabled in v0** — needs cross-repo commit
  fetching, which is expensive. Re-enable in v1.1 once we have a commits cache.
- Anonymization is conservative; expand blacklist if review surfaces leaked
  customer names.
- CLI fallback path (claude --print) can't force tool_use; we rely on JSON
  output contract instead. If the CLI returns malformed JSON, LLM signal is
  treated as a low-confidence error.
## Post-extraction cleanup

- **k5-336 (SILVER) manually removed** — LLM misidentified the inbox project
  (`techcenter/reportcenter_confidential`) as the fix repo. This is a known noise
  pattern: when comments don't mention any other repo, LLM sometimes defaults to
  the issue's containing project. Adding a hardcoded filter in
  `parseLLMExtractorOutput` to reject inbox paths (`techcenter/*`) is a TODO for
  a future iteration.

## Final usable GOLD set: 3 fixtures

- `k5-300.json` → `KEYPO/keypo-backend` (MR !366 + LLM agree)
- `k5-302.json` → `KEYPO/keypo-backend` (MR + LLM agree)
- `k5-304.json` → `KEYPO/keypo-engine-api` (MR + LLM agree)

## Observations + TODOs for Phase I v1.1

1. **Signal yield is ~2-3% GOLD** on K5 corpus. Root cause: MR cross-refs are
   sparse in GitLab system notes for this team (~5% coverage confirmed in earlier
   Assignment verification).
2. **Signal 2 (assignee heuristic) deferred** — unlocks the biggest potential
   gain. Implementation: fetch assignee's commits in ±3 day close window, match
   against label's candidate repos. Estimated boost: 30-50 GOLD from this
   corpus. Cost: +~5 GitLab API calls per issue × 135 = 675 extra calls (still
   free, within rate limits). Effort: ~2 hours CC.
3. **Inbox-repo filter** — reject `techcenter/*` from LLM-extracted `fix_repos`
   since those are never fix destinations (they're the ticket inboxes).
4. **Interesting drift signal**: `KEYPO/keypo-backend` appears in 2/3 GOLD but
   is NOT listed in `config/label-routing.yaml` K5 exceptions (though covered by
   primary_group=KEYPO). If drift audit (D4 script) surfaces it, fine. If not,
   consider adding to exceptions for visibility.
5. **Phase II on 3 fixtures is possible but noisy** — R@3 has ±30% CI. Treat as
   smoke test of the pipeline, not a real metric baseline.
