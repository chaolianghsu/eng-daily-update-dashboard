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
  "sha": "abc123",
  "title": "commit message",
  "project": "repo-name",
  "url": "https://github.com/bigdata-54837596/repo-name/commit/abc123",
  "author": "mapped-member-name",
  "date": "3/19",
  "source": "github"
}
```

GitLab collector (`collect-gitlab-commits.js`) updated to add `"source": "gitlab"` to each commit.

Supports `--date M/D` argument, consistent with GitLab collector.

### `scripts/fetch-github-commits.js`

Full pipeline script (parallel to `fetch-gitlab-commits.js`):

- Collection + analysis + POST in one run
- When run standalone, reads existing `public/gitlab-commits.json` commits for SHA dedup
- Exports shared functions: `collectCommits`, `buildPostPayload`

## §2: Merge Analysis & Dedup (Stage 2)

### `analyze-consistency.js` Extension

Accept multiple commit files:

```bash
# Existing
node scripts/analyze-consistency.js --commits /tmp/gitlab-commits.json

# New
node scripts/analyze-consistency.js --commits /tmp/gitlab-commits.json /tmp/github-commits.json
```

### Dedup Logic

1. Read all commit files, merge into single array
2. Dedup by **SHA** (same SHA on both platforms → keep one)
3. Retention: keep first occurrence (GitLab priority, as primary platform)
4. Log warning: `Dedup: commit abc123 found on both gitlab and github for project X`

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
2. **`DEDUP_KEY_CONFIG`** — update sheet name from `"GitLab Commits"` to `"Commits"`
3. **`doPost(e)`** — call `writeCommits_()` instead of `writeGitlabCommits_()`
4. **`getCommitData()`** — read from "Commits" sheet, parse `source` field

**Unchanged:** `writeDailyUpdates_()`, `writeCommitAnalysis_()`, `writeTaskAnalysis_()`

### Dedup Key

`date|member|sha` — unchanged. SHA is globally unique across platforms.

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

No changes needed. Reads `public/gitlab-commits.json` commits structure which is unchanged (`commits[date][member]`). Ignores `source` field.

### Testing

**Unit tests (Vitest):**
- `collect-github-commits.js` — mock GitHub API, verify memberMap mapping, pagination, date filtering
- `analyze-consistency.js` — multi-file merge, SHA dedup (same SHA across platforms keeps one), correct count after dedup
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
| `scripts/fetch-gitlab-commits.js` | Add `source: "gitlab"` to output + buildPostPayload |
| `scripts/analyze-consistency.js` | Multi-file input, SHA dedup logic |
| `src/types.ts` | `CommitItem.source` field |
| `src/CommitsView.tsx` | Source icons in commit detail table |
| `appscript/Code.gs` | Rename function/sheet, migration logic, source column |
| `.claude/skills/sync.md` | Add Agent C for GitHub in Stage 1 |
| `.claude/skills/sync-github-commits.md` | **New** — standalone GitHub sync skill |
| `github-config.json` | **New** (gitignored) — GitHub API config |
| `.gitignore` | Add `github-config.json` |
