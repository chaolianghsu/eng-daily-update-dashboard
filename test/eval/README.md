# Issue Routing — Eval Suite

Golden-fixture regression tests for the Phase 1 (routing) + Phase 2 (plan draft)
LLM pipeline defined in `lib/llm/`.

See `docs/superpowers/plans/2026-04-22-issue-routing.md` (Task B4) for the
design rationale.

## What it does

Each fixture in `test/eval/fixtures/*.json` describes a past issue (anonymized)
plus the expected routing outcome. The runner feeds each fixture through the
real Phase 1 + Phase 2 LLM pipeline and asserts:

- `phase1.layer` matches `expected.layer` exactly (when defined).
- At least one of `phase1.suggested_repos` is in `expected_repos_any_of`.
- At least one of `phase1.suggested_assignees` is in `expected_assignees_any_of`
  (skipped if the fixture leaves the list empty — used for low-confidence cases).
- `phase1.confidence` falls in `[min_confidence, max_confidence]`.
- The presence / absence of `phase2.plan_draft` matches `plan_draft_required`.

Pass rate must be ≥ 90% (e.g., 12 of 13 fixtures) for the run to exit 0.

## How to run

### Offline lint (no API calls, cheap, runs in CI on every PR)

```bash
EVAL_OFFLINE=1 bun run issue-routing:eval
```

Validates fixture shape + label references against `config/label-routing.yaml`.
Exits 0 if every fixture is well-formed. Does **not** import the Anthropic SDK.

### Online eval (real Phase 1 + Phase 2 calls)

```bash
ANTHROPIC_API_KEY=... bun run issue-routing:eval
```

Emits a JSON report to stdout: `{ date, total, passed, failed, failures, per_fixture }`.
Cost note: each fixture ≈ 2 API calls (Phase 1 + Phase 2). With ~13 fixtures that's
~26 calls per run, which is on the order of **$0.50 / run** on Sonnet 4.6.

Pass rate < 90% → exit 1.

## How to add a fixture

1. Copy any existing fixture file (e.g. `k5-agent-001-chat-reply-broken.json`)
   under `test/eval/fixtures/` with a descriptive kebab-case name.
2. Fill in:
   - `name` — unique id for reporting.
   - `issue` — `{ iid, title, description, labels, project_path, state }`. Keep
     it realistic but **anonymized** (see below).
   - `similar_issues` — 1–3 snippets from actual closed issues that the fixture
     is modeled after. Each: `{ iid, title, labels, assignee, closing_excerpt,
     resolution_hint? }`.
   - `expected` — `{ layer, expected_repos_any_of, expected_assignees_any_of,
     min_confidence, max_confidence, plan_draft_required }`.
3. Run `EVAL_OFFLINE=1 bun run issue-routing:eval` to lint the new fixture.
4. Open a PR — the `issue-routing-eval.yml` workflow lints automatically, and
   (if `ANTHROPIC_API_KEY` is configured on the PR) also runs the online eval.

## Fixture anonymization (REQUIRED)

Fixtures are **committed to the repo**. Do not include:

- Real customer names, project codenames, or brand identifiers tied to a client
- Real email addresses, phone numbers, IDs, tokens, secrets
- URLs that identify a specific customer deployment

Assignee usernames in fixtures are **illustrative** — pick realistic-looking
identifiers (e.g. `henry.lee`, `rita.lai`) that match the team pattern without
mirroring a real engineer's actual account. They exist to test the "suggested
assignee overlap" assertion, not to route real work.

If a new fixture must reference a scenario that contains PII, abstract it
(e.g. replace "某大型電商客戶 XYZ" with "某個客戶").

## Baseline tracking

`test/eval/baseline-v0.json` starts empty. The first production run snapshots
the initial passing %; subsequent runs can diff against the baseline to catch
regressions (work tracked in the design doc).

## Runner layout

- `run-eval.mjs` — entry point (`node test/eval/run-eval.mjs`, also exposed
  as `bun run issue-routing:eval`).
- Exports `compareToExpected(phase1, phase2, expected)` and
  `lintFixture(fixture, labelConfig)` for unit tests — see
  `test/unit/eval-runner.test.mjs`.
