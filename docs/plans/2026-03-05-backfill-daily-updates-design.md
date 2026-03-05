# Backfill Daily Updates - Design

## Overview

New skill `/backfill-daily-updates` to automatically fill in missing daily update data from Google Chat history. Complements the existing `/fetch-daily-updates` skill which only handles the current day.

## Scope

- Only backfills dates with NO entry in `rawData` (entire day missing)
- Does NOT regenerate `issues` array
- Does NOT overwrite existing date entries (append-only)

## Skill Interface

| Usage | Behavior |
|-------|----------|
| `/backfill-daily-updates` | Default: this week > last week > current month, backfill missing workdays |
| `/backfill-daily-updates 3/1-3/5` | Specific date range |
| `/backfill-daily-updates 3/3` | Single date |

Weekends (Sat/Sun) are excluded. Future dates are rejected.

### Date Range Priority (no argument)

1. This week (Monday through today)
2. Last week (Monday through Friday)
3. Remaining workdays in the current month
4. Deduplicate, filter out dates already in `rawData`, sort by priority

## Core Flow

```
Step 1: Load chat-config.json + raw_data.json
Step 2: Compute target date list
         - No args: this week > last week > current month, filter weekends + existing dates
         - With args: parse date range, same filters
Step 3: For each target date, search Google Chat threads
         - messages.list with orderBy: "createTime desc", pageSize: 100
         - Client-side: find messages containing queryKeyword + date string (e.g. "3/4")
         - Record thread.name, then filter replies from the same thread
Step 4: Parse each reply (reuse existing skill Step 4 logic)
         - sender -> memberMap -> member name
         - Regex extract hours
         - Classify meeting / dev
Step 5: Merge into rawData (append-only)
Step 6: Write raw_data.json, run npm test
Step 7: Show summary table, confirm then commit & push
```

## API Search Strategy

Google Chat `messages.list` does not support text-based or createTime-range filtering.

- Fetch with `orderBy: "createTime desc"`, `pageSize: 100`
- Client-side match: message text contains `queryKeyword` + target date string
- Multiple target dates share the same fetched message batch
- Pagination: use `nextPageToken`, max 5 pages (500 messages)
- Stop early once all target date threads are found

## Argument Parsing

| Input | Result |
|-------|--------|
| `3/3` | Single date |
| `3/1-3/5` | All workdays from 3/1 to 3/5 |
| (none) | Priority-based: this week > last week > current month |

Cross-month ranges (e.g. `2/28-3/5`) are supported.

## Error Handling

- Date not found in Chat: skip, mark as "not found" in summary
- All target dates already have data: display "nothing to backfill" and exit
- Invalid date format: show correct format hint
- Member not in `memberMap`: log warning, skip

## Output

Summary table after completion:

```
Date     | Status    | Members | Notes
---------|-----------|---------|--------
3/3 (Mon)| Success   | 10/12   | member1, member2 missing
3/5 (Wed)| Success   | 12/12   |
3/6 (Thu)| Not found |  --     | No thread in Chat
```

After user confirmation:
- `git add raw_data.json`
- `git commit -m "Backfill daily data for <dates>"`
- `git push`

Issues array is NOT modified. User can run `/fetch-daily-updates` afterwards to regenerate issues if needed.
