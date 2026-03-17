# Sync DAG Workflow Redesign

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Refactor /sync skill into a 3-stage DAG pipeline with parallel collection, sequential analysis, and automated task analysis

## Problem

1. `fetch-gitlab-commits.js` bundles data collection and consistency analysis in one script. This forced sequential execution (daily updates → GitLab) to avoid race conditions where analysis reads stale `raw_data.json`.
2. Task analysis is fully manual — requires running `prepare-task-analysis.js`, then manually feeding the prompt to Claude and saving the result.
3. No progress visibility during sync — the user doesn't see per-date status or which stage is running.

## Solution

Three-stage DAG pipeline:

```
Stage 1 (parallel):  Collect Daily Updates  ⇄  Collect GitLab Commits
                              ↘                    ↙
Stage 2 (wait both):     Consistency Analysis
                                 ↓
Stage 3 (wait Stage 2):   Task Analysis (automated)
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Script split | Two new scripts (B) | Single responsibility, filename = documentation |
| Existing script | Keep `fetch-gitlab-commits.js` as-is | Backwards compatible for standalone use |
| Task analysis | Fully automated via `claude --print` | Eliminates manual step |
| Progress display | DAG status in terminal | Shows stage states + per-date details |

## Script Changes

### New: `scripts/collect-gitlab-commits.js`

**Responsibility:** Fetch commits from GitLab API, map authors, output raw commits JSON to stdout. No analysis, no reading `raw_data.json`.

**Input:** `--date <M/D>` or `--date <M/D-M/D>`
**Output (stdout):** JSON array of mapped commits `[{ date, member, project, title, sha, url }, ...]`
**Stderr:** Progress messages (project names, commit counts, unmapped author warnings)

Extracts the collection logic from `fetch-gitlab-commits.js`: config reading, project discovery, commit fetching, author mapping. Does NOT call `buildAnalysis` or write `gitlab-commits.json`.

### New: `scripts/analyze-consistency.js`

**Responsibility:** Read `raw_data.json` + commits data → produce consistency analysis → write `gitlab-commits.json` (merged).

**Input:** `--commits <path-to-commits-json>` (output from collect-gitlab-commits.js)
**Reads:** `public/raw_data.json` for hours data
**Writes:** `public/gitlab-commits.json` (merges commits + analysis into existing file)
**Output (stdout):** JSON summary for POST to Sheets `{ gitlabCommits, commitAnalysis }`
**Stderr:** Analysis summary (per-date ✅/⚠️/🔴 counts)

Extracts `buildAnalysis`, `buildDashboardJSON`, and the merge logic from `fetch-gitlab-commits.js`.

### Existing: `fetch-gitlab-commits.js`

**Minor change:** Add `buildDashboardJSON` and `buildPostPayload` to `module.exports` (currently defined but not exported). Also extract config reading and project discovery into a reusable `loadConfigAndDiscoverProjects()` helper function exported for `collect-gitlab-commits.js` to use.

Still works standalone for one-off use (`/sync-gitlab-commits` skill). Keeps both collection + analysis in one script for backwards compatibility.

### Existing: `scripts/prepare-task-analysis.js`

**Unchanged.** Still generates the Claude prompt. Used by Stage 3 to pipe into `claude --print`.

## Skill Changes

### `sync.md` — Complete Rewrite

```
Stage 1 (parallel agents):
  - Agent A: /sync-daily-updates (unchanged skill)
  - Agent B: collect-gitlab-commits.js → save to /tmp/sync-<timestamp>-commits.json

Stage 2 (after both complete):
  - analyze-consistency.js --commits /tmp/sync-<timestamp>-commits.json
  - Writes gitlab-commits.json, commits + pushes
  - POSTs to Sheets

Stage 3 (after Stage 2):
  - prepare-task-analysis.js → claude --print → task-analysis.json
  - Commits + pushes
  - POSTs to Sheets
```

### Progress Display Format

Each stage shows its status with per-date details:

```
⏳ Stage 1 — 平行收集
  📊 Daily Updates     ✅ 3/14 (11/12) ✅ 3/16 (10/12)
  🔀 GitLab Commits    ✅ 3/14 (45) ✅ 3/15 (12) ⏳ 3/16...

⬚ Stage 2 — 一致性分析（等待 Stage 1）
⬚ Stage 3 — 任務合理性（等待 Stage 2）
```

After completion:

```
✅ Stage 1 — 平行收集 (32s)
✅ Stage 2 — 一致性分析 (2s)
  3/14: ✅ 8  ⚠️ 2  🔴 0
  3/16: ✅ 8  ⚠️ 2  🔴 0
✅ Stage 3 — 任務合理性 (15s)
  🔴 日銜 3/16 — 5H 開發, 0 commits
  🟡 Jason 3/16 — 7H/4 commits

✅ Sync All 完成 (49s) — 2 日期, 150 commits, 2 警示
```

### Other Skills — Unchanged

- `sync-daily-updates.md` — no changes needed
- `sync-gitlab-commits.md` — keeps using `fetch-gitlab-commits.js` (standalone mode)
- `fetch-daily-updates.md`, `backfill-daily-updates.md` — no changes

## Shared Code Strategy

`collect-gitlab-commits.js` and `analyze-consistency.js` import shared functions from `fetch-gitlab-commits.js`:

```javascript
// fetch-gitlab-commits.js exports at bottom (add buildDashboardJSON, buildPostPayload, loadConfigAndDiscoverProjects):
module.exports = {
  filterAndMapCommits, fetchAllPages, buildAnalysis,
  buildDashboardJSON, buildPostPayload, loadConfigAndDiscoverProjects,
};

// collect-gitlab-commits.js:
const { loadConfigAndDiscoverProjects, filterAndMapCommits, fetchAllPages } = require('./fetch-gitlab-commits');
// Note: fetchAllPages internally uses fetchJSON (private) — no need to export fetchJSON

// analyze-consistency.js:
const { buildAnalysis, buildDashboardJSON, buildPostPayload } = require('./fetch-gitlab-commits');
```

`loadConfigAndDiscoverProjects()` extracts the config reading (lines 252-258) and project discovery loop (lines 268-296) from `main()` into a reusable function.

This avoids code duplication while keeping each script focused.

## Task Analysis Automation

Stage 3 runs:

```bash
node scripts/prepare-task-analysis.js --date <date-range> | claude --print -m haiku > /tmp/task-analysis-result.json
```

**Fallback:** If `claude` CLI is not available or fails, skip Stage 3 and display a warning:
```
⚠️ Stage 3 — 跳過（claude CLI 不可用）
  手動執行: node scripts/prepare-task-analysis.js --date <range>
```

The result is validated as JSON before writing to `public/task-analysis.json`.

**Note:** `prepare-task-analysis.js` reads `public/gitlab-commits.json` from disk (line 102-103), so Stage 3 implicitly depends on Stage 2 having written that file. This is guaranteed by the DAG ordering.

**Model choice:** `haiku` is used for speed and cost efficiency. The prompt is structured enough that a smaller model produces reliable JSON output.

## Error Handling

**Stage 1 partial failure:**
- If daily updates fails but GitLab collection succeeds → Stage 2 proceeds with existing `raw_data.json` (stale but functional). Display warning.
- If GitLab collection fails but daily updates succeeds → Stage 2 skipped (no commits to analyze). Stage 3 skipped. Only daily update results committed.
- If both fail → abort with error.

**Stage 2 failure:** Skip Stage 3, commit whatever was collected in Stage 1.

**Stage 3 failure (claude CLI):** Already covered by fallback — display manual command.

## TDD Strategy

All new scripts follow Red-Green TDD: write failing test first, then minimal implementation to pass.

### Test Files

```
tests/
├── collect-gitlab-commits.test.js    ← NEW
├── analyze-consistency.test.js       ← NEW
├── fetch-gitlab-commits.test.js      ← EXISTING (add tests for new exports)
├── ...existing tests unchanged
```

### Red-Green Cycle

**1. `loadConfigAndDiscoverProjects` (extracted helper)**
- RED: Test that it reads gitlab-config.json and returns config + project list
- GREEN: Extract from `fetch-gitlab-commits.js` main()

**2. `collect-gitlab-commits.js`**
- RED: Test that it outputs commit JSON to stdout without reading raw_data.json
- RED: Test that it maps authors correctly using memberMap
- RED: Test that unmapped authors appear in stderr warnings
- GREEN: Implement script using shared functions

**3. `analyze-consistency.js`**
- RED: Test that it reads commits JSON + raw_data.json and produces correct analysis
- RED: Test ✅ status when both hours and commits present
- RED: Test ⚠️ status when hours but no commits
- RED: Test 🔴 status when commits but no hours
- RED: Test merge with existing gitlab-commits.json (preserves old dates)
- RED: Test date range limiting (only analyzes dates within commit range)
- GREEN: Implement script using shared functions

**4. `fetch-gitlab-commits.js` (backwards compatibility)**
- GREEN: Existing tests still pass after adding exports
- RED: Test that `buildDashboardJSON` and `buildPostPayload` are now exported
- GREEN: Add to module.exports

### Test Approach

- Mock file system reads (`fs.readFileSync`) for config and data files
- Mock HTTP requests for GitLab API calls (in collect tests)
- Use real `buildAnalysis` logic (no mocking) — test the actual analysis correctness
- Existing `fetch-gitlab-commits.test.js` already tests `filterAndMapCommits`, `fetchAllPages`, `buildAnalysis` — extend, don't duplicate

## Documentation Updates

Update CLAUDE.md to document:
- New scripts: `collect-gitlab-commits.js`, `analyze-consistency.js`
- Changed `/sync` workflow description (3-stage DAG)
- Task analysis automation

## Acceptance Criteria

- [ ] `collect-gitlab-commits.js` outputs commits JSON without reading raw_data.json
- [ ] `analyze-consistency.js` produces correct analysis from commits + raw_data.json
- [ ] `/sync` runs Stage 1 in parallel, Stage 2 after both complete, Stage 3 after Stage 2
- [ ] Progress display shows per-date status for each collector
- [ ] Task analysis runs automatically via `claude --print`
- [ ] `fetch-gitlab-commits.js` still works standalone (backwards compatible)
- [ ] All existing tests pass
- [ ] New tests for `collect-gitlab-commits.js` pass (Red-Green TDD)
- [ ] New tests for `analyze-consistency.js` pass (Red-Green TDD)
- [ ] `fetch-gitlab-commits.js` exports verified by test
- [ ] Spreadsheet receives all data (daily updates, commits, analysis, task analysis)
