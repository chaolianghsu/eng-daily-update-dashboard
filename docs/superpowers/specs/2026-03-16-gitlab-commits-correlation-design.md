# GitLab Commits x Daily Update Correlation

## Overview

Fetch engineering team's GitLab commits and correlate them with daily update data. Write results to the existing Google Spreadsheet and a local JSON file for the dashboard. Visualize commit activity and consistency analysis in the dashboard.

## Architecture

Follows existing pattern: Node.js script for data processing → outputs to local JSON + POST to Apps Script web app.

```
gitlab-config.json → fetch-gitlab-commits.js ─┬→ gitlab-commits.json (dashboard data)
                                               └→ POST → Apps Script → Spreadsheet
                                                                         ├── GitLab Commits (new tab)
                                                                         └── Commit Analysis (new tab)

index.html ─── fetches ─┬→ raw_data.json (existing)
                         └→ gitlab-commits.json (new)
```

## Components

### 1. gitlab-config.json (gitignored)

Stores GitLab API credentials and member mapping. File exists with `baseUrl` and `token` only; needs to be updated with `memberMap` and `excludeAuthors` fields below before first run.

```json
{
  "baseUrl": "https://biglab.buygta.today",
  "token": "<PAT with read_api scope>",
  "memberMap": {
    "joyce.kuo": "Joyce",
    "joyce": "Joyce",
    "Ted Juang": "Ted",
    "ted.juang": "Ted",
    "aaron.li": "Aaron",
    "Aaron li": "Aaron",
    "Joe Lu": "Joe",
    "joe": "Joe",
    "Ivy Wang": "Ivy",
    "ivywang": "Ivy",
    "jason.liu": "Jason",
    "Jason Liu": "Jason",
    "byron.you": "日銜",
    "wendyHsieh": "Wendy",
    "Wendy Hsieh": "Wendy",
    "yuriy.lin": "侑呈",
    "chris.su": "禎佑",
    "block.lee": "家輝",
    "Block": "家輝",
    "mason": "哲緯",
    "chaoliang.hsu": "兆良",
    "walt.peng": "Walt"
  },
  "excludeAuthors": ["GitLab CI", "patty", "richard", "李耀瑄", "leohu"]
}
```

### 2. scripts/fetch-gitlab-commits.js

**Input:** `--date <M/D>` (single date or range like `3/9-3/12`). Defaults to previous work day (skip weekends; holidays not handled).

**Date format conversion:** CLI accepts `M/D` (e.g., `3/11`). Script infers current year and converts to ISO 8601 (`2026-03-11T00:00:00+08:00` / `2026-03-12T00:00:00+08:00`) for GitLab API `since`/`until` params. Commit timestamps from API are converted back to `M/D` for output. Year rollover (Dec→Jan) is handled by checking if the month is in the future and adjusting year accordingly.

**Process:**
1. Read `gitlab-config.json`
2. Call `GET /api/v4/projects?membership=true&per_page=100&order_by=last_activity_at` to list projects. Handle pagination: follow `x-next-page` header if present (unlikely to exceed 100 for this team, but handled for correctness).
3. For each project, call `GET /api/v4/projects/:id/repository/commits?since=<start>&until=<end>&all=true&per_page=100`. Handle pagination similarly.
4. Filter out `excludeAuthors`
5. Map `author_name` to daily update member name via `memberMap`
6. Unmapped authors logged as warnings (not treated as errors)
7. Output structured JSON to stdout

**Error handling:**
- 401 Unauthorized → exit with message "GitLab token invalid or expired"
- 429 Rate Limited → wait and retry (up to 3 times)
- Network errors → exit with descriptive message
- Empty projects (no repository) → skip silently

**Output format:**
```json
{
  "fetchDate": "2026-03-16",
  "dateRange": { "since": "3/11", "until": "3/11" },
  "commits": [
    {
      "member": "Joyce",
      "date": "3/11",
      "project": "KEYPO/keypo-backend",
      "title": "[feat] Remove token del",
      "sha": "339d2d85"
    }
  ],
  "summary": {
    "Joyce": {
      "totalCommits": 5,
      "projects": ["KEYPO/keypo-backend"],
      "activeDays": 1
    }
  }
}
```

### 3. appscript/Code.gs Changes

**New function: `writeGitlabCommits_(ss, commits)`**
- Writes to `GitLab Commits` tab
- Columns: 日期 | 成員 | Project | Commit Title | SHA
- Deduplication key: `date|member|sha` (append mode, no overwrite)

**New function: `writeCommitAnalysis_(ss, analysis)`**
- Writes to `Commit Analysis` tab
- Columns: 日期 | 成員 | Commits數 | Daily Update工時 | 狀態 | 參與Projects
- Status values: ✅ 一致 | ⚠️ 有工時無commits | 🔴 有commits未報工時
- Deduplication key: `date|member` (overwrite mode — latest analysis replaces previous)

**`commitAnalysis` payload shape:**
```json
[
  {
    "date": "3/11",
    "member": "Joyce",
    "commitCount": 5,
    "dailyUpdateHours": 9,
    "status": "✅",
    "projects": "KEYPO/keypo-backend, KEYPO/keypo-engine/keypo-engine-api-v3"
  }
]
```

Members with GitLab accounts but no daily update entry (兆良, Walt) are included in the GitLab Commits tab but excluded from the consistency check analysis, since they have no daily update data to compare against.

**doPost() update:**
- Accept optional `gitlabCommits` and `commitAnalysis` fields in payload
- Backward compatible: guard each write call with `if (data.field)` check so existing daily-update-only POST calls continue to work, and GitLab-only POST calls skip `writeRawData_()` etc.

```javascript
// Updated doPost pattern:
if (data.rawData) writeRawData_(ss, data.rawData);
if (data.issues) writeIssues_(ss, data.issues);
if (data.leave) writeLeave_(ss, data.leave);
if (data.dailyUpdates) writeDailyUpdates_(ss, data.dailyUpdates);
if (data.gitlabCommits) writeGitlabCommits_(ss, data.gitlabCommits);
if (data.commitAnalysis) writeCommitAnalysis_(ss, data.commitAnalysis);
```

### 4. Analysis Features

#### 4a. Consistency Check

Compare commits vs daily update for each member per date:
- ✅ Both present — member reported hours and has commits
- ⚠️ Hours reported, 0 commits — could be meetings/review/design (informational, not necessarily a problem)
- 🔴 Commits exist, no daily update — missed report

Analysis is computed in `fetch-gitlab-commits.js` by cross-referencing with `raw_data.json`.

#### 4b. Project Participation

Per-member commit distribution across projects:
- Identify single-point-of-failure: projects where only 1 member commits
- Member workload spread: how many projects each person touches

#### 4c. Risk Warning Integration

Generate commit-based risk warnings in the same format as existing `issues` entries. These are written to the `Commit Analysis` Spreadsheet tab only — `raw_data.json` issues array is NOT modified (keeping the two data sources independent).

- 🟡 "連續 3 天有報工時但 0 commits" (3+ days reported hours with 0 commits)
- 🔴 "有 commits 但未回報 daily update" (commits exist but no daily update)
- Follows existing severity convention: 🔴 critical, 🟡 warning, 🟠 caution, 🟢 improvement

### 5. gitlab-commits.json (Dashboard Data)

Output by `fetch-gitlab-commits.js` alongside its stdout JSON. Fetched by `index.html` at runtime (parallel with `raw_data.json`). Dashboard gracefully handles missing file (commit features hidden).

```json
{
  "commits": {
    "3/11": {
      "Joyce": {
        "count": 5,
        "projects": ["KEYPO/keypo-backend"],
        "items": [
          { "title": "[feat] Remove token del", "sha": "339d2d85", "project": "KEYPO/keypo-backend" }
        ]
      }
    }
  },
  "analysis": {
    "3/11": {
      "Joyce": { "status": "✅", "commitCount": 5, "hours": 9 },
      "Ted": { "status": "⚠️", "commitCount": 0, "hours": 7.5 }
    }
  },
  "projectRisks": [
    { "project": "KEYPO/keypo-data-api", "soloContributor": "家輝", "severity": "🟡" }
  ]
}
```

### 6. index.html Dashboard Changes

#### 6a. Data Loading

Add parallel fetch of `gitlab-commits.json` alongside `raw_data.json`. If `gitlab-commits.json` is missing or fails, set `commitData` to `null` and hide all commit-related UI. No error state shown — commit features are optional.

#### 6b. New Tab: 🔀 Commits

Fourth tab added to existing tab bar: `{ key: "commits", label: "🔀 Commits" }`.

Three sections:

**Consistency Grid** — A date × member matrix. Each cell is a colored dot:
- ✅ (green): both commits and daily update present
- ⚠️ (yellow/orange): hours reported but 0 commits (may be meetings/review)
- 🔴 (red): commits exist but no daily update
- Gray: no data (on leave or no activity)

Layout similar to GitHub contribution graph. Dates on X axis, members on Y axis.

**Project Participation** — Horizontal stacked bar chart (Recharts `BarChart`). Each member's bar shows commit count per project, color-coded by project. Below the chart, a warning section lists single-point-of-failure projects (only 1 contributor).

**Commit Detail Table** — Collapsible by member. Columns: Date | Project | Title | SHA. Sorted by date descending.

#### 6c. Daily View Enhancement

Member cards gain two additions:
- **Commit badge**: Top-right corner, teal/cyan (`#06b6d4`) pill showing commit count (e.g., "3 commits"). Hidden if 0 or no commit data.
- **Consistency indicator**: Small status icon next to the existing status badge (✅/⚠️/🔴).
- **Hover detail**: On card hover, if commits exist, show a brief tooltip or expanded section listing project + title for each commit.

#### 6d. Trend View Enhancement

Add commit count as a secondary Y-axis (right side) on the existing ComposedChart. Rendered as bars (thin, semi-transparent teal) behind the existing hour lines. This shows the correlation between hours reported and commits per day.

#### 6e. Issues Ticker Integration

The Status Overview attention cards section displays commit-related warnings from `projectRisks` and `analysis` data alongside existing daily update issues. Uses the same severity color system.

#### 6f. Design Language

- **Commit accent color**: Teal/cyan `#06b6d4` (distinguish from blue `#3b82f6` used for hours/dev)
- **Consistency colors**: Reuse existing SEVERITY_COLORS (🔴 red, 🟡 yellow, 🟢 green)
- **New elements** follow existing patterns: dark cards, rounded corners, hover transitions, responsive grid
- **Typography**: Same font stack (JetBrains Mono, SF Mono, Noto Sans TC)

### 7. Skills

#### .claude/skills/sync-gitlab-commits.md

Standalone skill:
1. Read `gitlab-config.json`
2. Run `node scripts/fetch-gitlab-commits.js --date <date>`
3. Review output (script writes `gitlab-commits.json` and outputs POST payload to stdout)
4. POST payload to Apps Script web app
5. Output summary

#### .claude/skills/sync.md

Unified orchestration skill:
1. Run `/sync-daily-updates` and `/sync-gitlab-commits` in parallel using the Agent tool with `run_in_background: true` for one and foreground for the other, or sequentially if parallel execution is unreliable
2. Show real-time progress for each
3. After both complete, show combined summary: member | commits | hours | status

## Member Mapping

| Daily Update | GitLab username(s) | GitLab Name |
|---|---|---|
| Joyce | joyce, joyce.kuo | joyce.kuo |
| Ivy | ivywang, Ivy Wang | Ivy Wang |
| Jason | jason.liu, Jason Liu | Jason Liu |
| 日銜 | byron.you | 游日銜 |
| Wendy | wendyHsieh, Wendy Hsieh | Wendy Hsieh |
| 侑呈 | yuriy.lin | 林侑呈 |
| 禎佑 | chris.su | 蘇禎佑 |
| Ted | ted.juang, Ted Juang | Ted Juang |
| 家輝 | block.lee, Block | 李家輝 |
| Joe | joe, Joe Lu | Joe Lu |
| Aaron | aaron.li, Aaron li | Aaron li |
| 哲緯 | mason | 林哲緯 |
| 兆良 | chaoliang.hsu | 徐兆良 |
| Walt | walt.peng | 彭志驊 |

Excluded: GitLab CI, patty, richard, 李耀瑄, leohu

## File Changes Summary

**New files:**
- `gitlab-config.json` (gitignored) — already created (needs memberMap/excludeAuthors update)
- `gitlab-commits.json` — dashboard commit data (generated by script)
- `scripts/fetch-gitlab-commits.js`
- `.claude/skills/sync-gitlab-commits.md`
- `.claude/skills/sync.md`

**Modified files:**
- `appscript/Code.gs` — add `writeGitlabCommits_()`, `writeCommitAnalysis_()`, update `doPost()`
- `index.html` — add commits tab, daily view badges, trend overlay, issues integration
- `.gitignore` — already done

**Unchanged:**
- `raw_data.json` schema
- `.claude/skills/sync-daily-updates.md`
- `scripts/parse-daily-updates.js`
- `scripts/merge-daily-data.js`
