# Apps Script Multi-Center Schema Migration

This is a one-shot migration for the Spreadsheet that backs the Apps Script
dashboard. The new schema prepends `parentCenter` and `department` columns to
every per-member sheet, adds three new sheets (`Centers`, `Departments`,
`Items`), and changes dedup keys from `date|member` to `date|dept|member`.

There are TWO categories of sheets, and they migrate differently:

- **Full-rewrite sheets** (`rawData`, `issues`, `leave`) — `writeRawData_`,
  `writeIssues_`, `writeLeave_` all call `sheet.clear()` before writing. These
  auto-migrate on the next normal `/sync` POST. No action needed.
- **Dedup-append sheets** (`Daily Updates`, `Commits`, `Commit Analysis`,
  `Task Analysis`, `Plan Specs`, `Plan Correlations`) — these accumulate
  history and must NOT be cleared. Use the non-destructive
  `migrateSchema` POST below, which prepends the two new columns in place
  and backfills values from the centers/parentCenters payload.

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

### 2. Non-destructive schema migration for existing data

If you have an existing Spreadsheet with OLD-schema data in dedup-append sheets
(`Daily Updates`, `Commits`, `Commit Analysis`, `Task Analysis`, `Plan Specs`,
`Plan Correlations`), DO NOT `clearSheets` those — that wipes accumulated
history. Instead, run a `migrateSchema` POST. It idempotently prepends
`parentCenter` and `department` columns at position 1 of each dedup-append
sheet, backfilling values via the `centers` config in the payload. Already-
migrated sheets are skipped (no-op). Re-running is safe.

For the 3 full-rewrite sheets (`rawData`, `issues`, `leave`), no migration is
needed — the next normal `/sync` POST auto-rewrites them in NEW schema.

Replace `$APPSCRIPT_URL` with your deployed `/exec` endpoint.

```bash
curl -L -X POST "$APPSCRIPT_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"migrateSchema\":true,\"centers\":$(node -e 'console.log(JSON.stringify(require(\"./public/raw_data.json\").centers))'),\"parentCenters\":$(node -e 'console.log(JSON.stringify(require(\"./public/raw_data.json\").parentCenters))')}"
```

Expected response (each per-sheet entry reports a `reason`:
`completed` | `already_migrated` | `empty` | `not_found`):

```json
{
  "status": "ok",
  "operation": "migrateSchema",
  "results": {
    "Daily Updates":     { "migrated": 312, "skipped": 0, "reason": "completed" },
    "Commits":           { "migrated": 1248, "skipped": 0, "reason": "completed" },
    "Commit Analysis":   { "migrated": 312, "skipped": 0, "reason": "completed" },
    "Task Analysis":     { "migrated": 17, "skipped": 0, "reason": "completed" },
    "Plan Specs":        { "migrated": 0, "skipped": 0, "reason": "empty" },
    "Plan Correlations": { "migrated": 0, "skipped": 1, "reason": "already_migrated" }
  }
}
```

If `lookups.memberToDept` is empty (caller forgot to include `centers`), the
endpoint returns `{ status: "error", error: "..." }` and migrates nothing.

#### Legacy destructive flow (only if you want a clean wipe)

Only useful if you are willing to lose all dedup-append history. Wipes every
schema-changed sheet plus the three new ones (clearing a non-existent sheet is
a no-op on the server side, so listing them is safe).

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
