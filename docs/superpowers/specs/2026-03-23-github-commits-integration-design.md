# GitHub Commits Integration Design

**Date:** 2026-03-23
**Status:** Approved

## Overview

Add GitHub commits collection alongside existing GitLab integration. Dashboard merges commits from both platforms with source icons. Spreadsheet tracks commit source. Cross-platform SHA dedup prevents double-counting.

## Requirements

- Collect commits from GitHub.com org `bigdata-54837596` via PAT
- `github-config.json` (gitignored) stores token, org, memberMap, excludeAuthors
- Subset of the 14 daily update members have GitHub activity
- SHA-based dedup across platforms (same project may exist on both, not mirrored)
- Dashboard: merged display with source icon per commit
- Spreadsheet: single "Commits" sheet with `source` column
- `/sync` DAG includes GitHub collection in Stage 1; standalone `/sync-github-commits` skill also available

## Architecture: Independent Collection, Merged Analysis (方案 A)

```
Stage 1 (parallel):
  Agent A: /sync-daily-updates → raw_data.json
  Agent B: collect-gitlab-commits.js --date M/D → /tmp/gitlab-commits.json
  Agent C: collect-github-commits.js --date M/D → /tmp/github-commits.json

Stage 2 (sequential):
  analyze-consistency.js --commits /tmp/gitlab-commits.json /tmp/github-commits.json
  → SHA dedup → merge → analysis → public/gitlab-commits.json

Stage 3 (sequential, unchanged):
  prepare-task-analysis.js | claude --print → public/task-analysis.json
```

## §1: Config & Collection Script

### `github-config.json` (gitignored)

```json
{
  "baseUrl": "https://api.github.com",
  "org": "bigdata-54837596",
  "token": "<PAT with repo scope>",
  "memberMap": {
    "github-username-1": "成員A",
    "github-username-2": "成員B"
  },
  "excludeAuthors": ["dependabot[bot]", "github-actions[bot]"]
}
```

### `scripts/collect-github-commits.js`

Symmetric to `collect-gitlab-commits.js`:

1. Read `github-config.json`
2. `GET /orgs/{org}/repos` — list all repos (paginated)
3. For each repo: `GET /repos/{owner}/{repo}/commits?since=&until=` — fetch commits
4. Map authors via `memberMap`; log unmapped authors as warnings
5. Output JSON to stdout with `source: "github"` on each commit

Output format per commit (same as GitLab collector + `source`):

```json
{
  "sha": "20faa17b",
  "title": "commit message",
  "project": "repo-name",
  "url": "https://github.com/bigdata-54837596/repo-name/commit/abc123...",
  "author": "mapped-member-name",
  "date": "3/19",
  "source": "github"
}
```

### SHA Normalization

Existing GitLab collector uses `short_id` (8-char prefix). GitHub API returns full 40-char SHA. To ensure cross-platform dedup works:

- GitHub collector truncates SHA to 8 characters (`commit.sha.slice(0, 8)`) to match GitLab's `short_id` format
- Dedup key `sha|project` uses these normalized 8-char SHAs
- `url` field retains full SHA for valid links (GitHub URLs work with full SHA)

### `source` Field in GitLab Collector

GitLab's `filterAndMapCommits()` in `fetch-gitlab-commits.js` updated to add `source: "gitlab"` to each commit item. `collect-gitlab-commits.js` delegates to `collectCommits()` which calls `filterAndMapCommits()`, so both scripts inherit the change.

Supports `--date M/D` argument, consistent with GitLab collector.

### GitHub API Pagination & Rate Limiting

- GitHub uses `Link` header pagination (not `x-next-page` like GitLab)
- Authenticated PAT: 5000 requests/hour rate limit
- Check `X-RateLimit-Remaining` header; if exhausted, log warning and stop (don't retry)
- Use `per_page=100` for efficient pagination

### `scripts/fetch-github-commits.js`

Full pipeline script (parallel to `fetch-gitlab-commits.js`):

- Collection + analysis + POST in one run
- When run standalone: reads existing `public/gitlab-commits.json`, extracts all existing SHAs into a Set, filters out GitHub commits whose normalized SHA already exists, then runs analysis with merged commits
- Exports shared functions: `collectCommits`, `buildPostPayload`

## §2: Merge Analysis & Dedup (Stage 2)

### `analyze-consistency.js` Extension

Accept multiple commit files. Argument parsing: collect all non-flag arguments after `--commits` until the next `--` flag:

```bash
# Existing (still works)
node scripts/analyze-consistency.js --commits /tmp/gitlab-commits.json

# New
node scripts/analyze-consistency.js --commits /tmp/gitlab-commits.json /tmp/github-commits.json
```

Parsing logic change:
```javascript
// Before: commitsPath = args[i + 1]; i++;
// After: collect all paths until next flag
const commitsPaths = [];
for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) {
  commitsPaths.push(args[j]);
}
```

Read each file, merge into single `allCommits` array, then proceed with existing analysis.

### Dedup Logic

1. Read all commit files, merge into single array
2. Dedup by **normalized SHA** (8-char) + **project** as composite key (`sha|project`)
3. Retention: keep first occurrence (GitLab files listed first → GitLab priority)
4. Log warning: `Dedup: commit 20faa17b found on both gitlab and github for project X`
5. Edge case: same SHA + different project → keep both (different repos, not a duplicate)

### `public/gitlab-commits.json` Schema Change

Filename unchanged (renaming would touch too many files for little benefit).

`CommitItem` gains `source` field:

```json
{
  "commits": {
    "3/19": {
      "成員A": {
        "count": 5,
        "projects": ["repo-1", "repo-2"],
        "items": [
          { "title": "...", "sha": "...", "project": "...", "url": "...", "source": "gitlab" },
          { "title": "...", "sha": "...", "project": "...", "url": "...", "source": "github" }
        ]
      }
    }
  },
  "analysis": { "unchanged" },
  "projectRisks": [ "unchanged" ]
}
```

- `source`: `"gitlab"` | `"github"`
- `analysis` and `projectRisks` structure unchanged (post-merge results)
- Old data without `source` field: frontend falls back to `"gitlab"`

### `buildDashboardJSON` Update

In `fetch-gitlab-commits.js`, `buildDashboardJSON()` must propagate `source` to each commit item:

```javascript
// Before: m.items.push({ title: c.title, sha: c.sha, project: c.project, url: c.url, datetime: c.datetime });
// After:  m.items.push({ title: c.title, sha: c.sha, project: c.project, url: c.url, datetime: c.datetime, source: c.source });
```

### `buildPostPayload` Update

`buildPostPayload()` must include `source` in each commit entry for the Spreadsheet POST:

```javascript
// Add source field to each gitlabCommits payload item
{ date, member, project, title, sha, url, source: c.source }
```

The POST payload key remains `gitlabCommits` for backward compatibility with deployed Apps Script. Renaming is deferred to avoid coordinated deployment.

## §3: Dashboard Frontend

### `types.ts`

```typescript
interface CommitItem {
  title: string
  sha: string
  project: string
  url: string
  datetime?: string
  source?: 'gitlab' | 'github'  // optional for backward compat
}
```

### `CommitsView.tsx`

**Source icon per commit:**
- GitLab: 🦊 (or GitLab SVG)
- GitHub: 🐙 (or GitHub SVG)
- Missing `source`: defaults to GitLab icon
- Small, muted grey — non-distracting, consistent with teal accent (`#06b6d4`)

**Unchanged areas:**
- Scatter chart — uses merged count
- Summary table — uses merged count
- Project participation bar chart — deduped, no double counting

### Backward Compatibility

- `source` optional — old data doesn't break
- `main.tsx` fetch unchanged (filename preserved)
- Daily, Trend, Weekly views unaffected

## §4: Spreadsheet & Apps Script

### Sheet Rename: "GitLab Commits" → "Commits"

New `source` column added.

| date | member | sha | project | title | url | source |
|------|--------|-----|---------|-------|-----|--------|
| 3/19 | 成員A | abc123 | repo-1 | fix bug | https://... | gitlab |
| 3/19 | 成員B | def456 | repo-2 | add feature | https://... | github |

### `Code.gs` Changes

1. **`writeGitlabCommits_()`** → rename to **`writeCommits_()`** with auto-migration:
   - Try to get "Commits" sheet
   - If not found → try "GitLab Commits" sheet
   - If found → rename to "Commits", add "source" header, backfill existing rows with `"gitlab"`
   - If neither found → create new "Commits" sheet
   - Idempotent: runs safely multiple times
2. **`DEDUP_KEY_CONFIG`** — register both `"Commits"` and `"GitLab Commits"` with the same key config (`date|member|sha`). This handles the case where `dedupSheets_` runs before migration (sheet still named "GitLab Commits"). After migration completes, only "Commits" will match.
3. **`doPost(e)`** — payload key stays `data.gitlabCommits` (backward compat with deployed callers), but handler calls `writeCommits_()`:
   ```javascript
   if (data.gitlabCommits) writeCommits_(ss, data.gitlabCommits);
   ```
4. **`getCommitData()`** — read path update:
   - Try "Commits" sheet first, fall back to "GitLab Commits"
   - Detect column count (6 = old format, 7 = new with source)
   - Parse `source` from 7th column; default `"gitlab"` for 6-column rows
   - Return `source` field in each commit item

**Unchanged:** `writeDailyUpdates_()`, `writeCommitAnalysis_()`, `writeTaskAnalysis_()`

### Dedup Key

`date|member|sha` — unchanged. Normalized 8-char SHA is unique across platforms.

## §5: `/sync` DAG & `/sync-github-commits` Skill

### `/sync` Skill Update

Stage 1 adds Agent C for GitHub:

```
Stage 1 (parallel):
  Agent A: /sync-daily-updates
  Agent B: collect-gitlab-commits.js --date M/D → /tmp/gitlab-commits.json
  Agent C: collect-github-commits.js --date M/D → /tmp/github-commits.json

Stage 2 (waits for B + C):
  analyze-consistency.js --commits /tmp/gitlab-commits.json /tmp/github-commits.json

Stage 3 (unchanged):
  prepare-task-analysis.js | claude --print
```

### `/sync-github-commits` Skill

New `.claude/skills/sync-github-commits.md`, symmetric to `sync-gitlab-commits.md`:

- Read `github-config.json`
- Run `node scripts/fetch-github-commits.js --date M/D`
- Support backfill: `/sync-github-commits 3/9-3/12`
- POST to Google Sheets
- Commit + push
- Optional Chat notification

### Script Reference

| GitLab | GitHub | Purpose |
|--------|--------|---------|
| `collect-gitlab-commits.js` | `collect-github-commits.js` | Collection only (Stage 1) |
| `fetch-gitlab-commits.js` | `fetch-github-commits.js` | Full: collect + analyze + POST |
| `analyze-consistency.js` | shared | Merge analysis (Stage 2) |

## §6: Task Analysis & Testing

### `prepare-task-analysis.js`

Minor change only: update prompt section header from `"### GitLab Commits (same day):"` to `"### Commits (same day):"` for accuracy. No logic changes — the script reads `public/gitlab-commits.json` commits structure which is unchanged (`commits[date][member]`).

### Testing

**Unit tests (Vitest):**
- `collect-github-commits.js` — mock GitHub API, verify memberMap mapping, pagination, date filtering, SHA truncation to 8 chars
- `analyze-consistency.js` — multi-file merge, SHA dedup edge cases:
  - Same SHA + same project on both platforms → keep one (GitLab priority)
  - Same SHA + different project → keep both (not a duplicate)
  - Single file input (backward compat) → works as before
- Schema validation — `CommitItem` with `source` field

**Frontend tests (Vitest + jsdom):**
- `CommitsView` — render source icons, old data without `source` falls back to GitLab icon

**E2E tests (Playwright):**
- Commit detail table shows correct source icons
- Mixed-source data renders correctly

### Unchanged

- Daily View, Trend View, Weekly View — don't read commit source
- `main.tsx` fetch — filename unchanged
- `styles.css` — no new classes
- `constants.ts` — no new constants

## Files Changed Summary

| File | Change |
|------|--------|
| `scripts/collect-github-commits.js` | **New** — GitHub collection script |
| `scripts/fetch-github-commits.js` | **New** — Full GitHub pipeline script |
| `scripts/collect-gitlab-commits.js` | Add `source: "gitlab"` to output |
| `scripts/fetch-gitlab-commits.js` | Add `source: "gitlab"` to `filterAndMapCommits`, `buildDashboardJSON`, `buildPostPayload` |
| `scripts/analyze-consistency.js` | Multi-file input, SHA dedup logic, argument parsing |
| `scripts/prepare-task-analysis.js` | Update prompt header "GitLab Commits" → "Commits" |
| `src/types.ts` | `CommitItem.source` field |
| `src/CommitsView.tsx` | Source icons in commit detail table |
| `appscript/Code.gs` | Rename function/sheet, migration logic, source column |
| `.claude/skills/sync.md` | Add Agent C for GitHub in Stage 1 |
| `.claude/skills/sync-github-commits.md` | **New** — standalone GitHub sync skill |
| `github-config.json` | **New** (gitignored) — GitHub API config |
| `.gitignore` | Add `github-config.json` |
