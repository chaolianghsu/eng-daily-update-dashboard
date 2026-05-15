# Apps Script Multi-Center Schema Migration

This is a one-shot migration for the Spreadsheet that backs the Apps Script
dashboard. The new schema prepends `parentCenter` and `department` columns to
every per-member sheet, adds three new sheets (`Centers`, `Departments`,
`Items`), and changes dedup keys from `date|member` to `date|dept|member`.

The old schema is column-incompatible with the new one, so we clear the
affected sheets first and then re-POST the current full dataset.

## When to run

Run **once**, after merging `feat/appscript-multi-center` and deploying
`appscript/Code.gs`. The deploy step (`bun run deploy:appscript`) is owned by
the human operator — the agent that produced this branch does not push.

## Steps

### 1. Deploy the new Code.gs

```bash
bun run build:appscript     # regenerates appscript/index.html (gitignored)
bun run deploy:appscript    # clasp push — needs interactive login on first use
```

### 2. Clear the old sheets

This wipes every sheet whose schema changed plus the three new ones (clearing a
non-existent sheet is a no-op on the server side, so listing them is safe).

Replace `$APPSCRIPT_URL` with your deployed `/exec` endpoint.

```bash
curl -L -X POST "$APPSCRIPT_URL" \
  -H 'Content-Type: application/json' \
  -d '{
    "clearSheets": [
      "rawData",
      "issues",
      "leave",
      "Daily Updates",
      "Commits",
      "Commit Analysis",
      "Task Analysis",
      "Plan Specs",
      "Plan Correlations",
      "Centers",
      "Departments",
      "Items"
    ]
  }'
```

### 3. Re-POST the full current dataset

The simplest way is to run `/sync` end-to-end on the current date range — it
collects daily updates, GitLab + GitHub commits, runs consistency analysis,
task analysis, plan analysis, and POSTs the full payload (including
`centers` + `parentCenters` from `public/raw_data.json`).

If you prefer a one-shot manual POST, construct the payload from
`public/raw_data.json` + `public/gitlab-commits.json` + `public/task-analysis.json`
+ `public/plan-analysis.json` and POST in a single request. The payload shape
mirrors the existing `/sync` POST plus two new blocks:

```json
{
  "rawData": { /* ... */ },
  "issues": [ /* ... */ ],
  "leave": { /* ... */ },
  "dailyUpdates": [ /* ... */ ],
  "gitlabCommits": [ /* ... */ ],
  "commitAnalysis": [ /* ... */ ],
  "taskAnalysis": { /* ... */ },
  "planAnalysis": { /* ... */ },
  "centers": {
    "工程": { "label": "工程部", "parent": "產品中心", "members": ["Joyce", ...] },
    "技發": { "label": "技術發展部", "parent": "產品中心", "members": ["Richard", "Patty"] }
  },
  "parentCenters": {
    "產品中心": { "label": "產品中心", "children": ["工程", "技發"] }
  }
}
```

### 4. Verify

The POST response will include counts:

```json
{
  "status": "ok",
  "dates": 55,
  "commits": 1234,
  "taskWarnings": 17,
  "planSpecs": 3,
  "items": 4567,
  "parentCenters": 1,
  "departments": 2
}
```

Open the Spreadsheet and confirm:
- `Centers`, `Departments`, `Items` sheets exist.
- `rawData` row 1 begins with `parentCenter | department | date | member | ...`.
- `Items` rows are populated with `code` + `hours` per task.

## Rollback

The migration is destructive (it `clear()`s the affected sheets). If you need
to roll back:

1. Restore the Spreadsheet from version history (File → Version history).
2. Redeploy the pre-multi-center `Code.gs` via clasp from the prior commit.

Because the new `Code.gs` read helpers are schema-aware (they detect the
header row's first cell), they will also work against the old schema if you
need to fall back without re-clearing — but post-migration writes will be
rejected by dedup logic that expects the new column positions, so prefer a
clean restore.
