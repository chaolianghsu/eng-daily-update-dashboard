# Backfill Daily Updates from Google Chat

Backfill missing daily update data from Google Chat history into `raw_data.json`.

## Usage

- `/backfill-daily-updates` — auto-detect missing workdays (this week > last week > current month)
- `/backfill-daily-updates 3/3` — backfill a single date
- `/backfill-daily-updates 3/1-3/5` — backfill a date range

## Prerequisites

- `chat-config.json` exists with `spaceId`, `memberMap`, `queryKeyword`
- `raw_data.json` exists with current data

## Workflow

### Step 1: Load config and current data

Read `chat-config.json` to get `spaceId`, `memberMap`, `queryKeyword`.
Read `raw_data.json` to get existing `rawData` and `issues`.

### Step 2: Compute target dates

**If argument is provided:**
- Single date (e.g. `3/3`): target = `["3/3"]`
- Date range (e.g. `3/1-3/5` or cross-month `2/28-3/5`): expand to all dates inclusive
- Reject future dates. Show error for invalid format.

**If no argument:**
1. Compute this week's workdays (Monday through today)
2. Compute last week's workdays (Monday through Friday)
3. Compute remaining workdays in the current month (1st through today)
4. Combine in priority order: this week, last week, rest of month

**For all modes:**
- Exclude weekends (Saturday = `getDay() === 6`, Sunday = `getDay() === 0`)
- Exclude dates already present as keys in `rawData`
- If no dates remain, display "沒有需要補的日期" and stop

Use current year for all date computations. Format dates as `M/D` (no zero-padding) to match `rawData` keys.

### Step 3: Search Google Chat for Daily Update threads

Use `mcp__gws__chat_spaces_messages_list` to fetch messages:

```
params: { parent: "<spaceId>", pageSize: 100, orderBy: "createTime desc" }
```

For each page of results, scan messages client-side:
- For each target date still not found, check if the message text contains BOTH the `queryKeyword` (e.g. "Daily Update") AND the date string (e.g. "3/3")
- When a match is found, record its `thread.name` and associate it with that target date
- Also collect all other messages in the same batch that share the same `thread.name` — these are the replies
- **Also collect leave messages**: While scanning each page, filter messages where `text` contains `請假` or `休假`. Build a leave map using the same logic as `/fetch-daily-updates` Step 2.5 (identify member via `sender.name` → `memberMap`, parse date range from text). This is a filter added to the existing scan loop, NOT a separate API call.

If not all target dates are found after one page, use `nextPageToken` to fetch the next page. Maximum 5 pages (500 messages). Stop early if all target dates are found.

### Step 4: For each found thread, get all replies

For each target date with a matched thread:
- Filter the fetched messages by `thread.name` to get all replies in that thread
- If the batch doesn't contain all replies (thread might span beyond fetched pages), make an additional `mcp__gws__chat_spaces_messages_list` call with `pageSize: 50` and filter by the thread name

### Step 5: Parse each reply into structured data

Reuse the same parsing logic as `/fetch-daily-updates` Step 4:

- **Sender**: Map `sender.name` (e.g. `users/12345`) to member name via `memberMap`. Skip unknown senders with a warning.
- **Hours**: Sum all hour values matching regex: `[（(]\s*(\d+(?:\.\d+)?)\s*(?:[Hh](?:r|our|ours)?|小時)[^)）]*[)）]`
  - Matches: `(1hr)`, `(1H)`, `(1 hour)`, `(1小時)`, `(1 小時)`, `（1.5H）`
  - Does NOT match bare `(7)` — too ambiguous (could be task count, not hours)
  - Items containing meeting/會議/讀書會/例會/討論/分享會/sync/臨時會 keywords -> `meeting` hours
  - Everything else -> `dev` hours
  - `total` = `meeting` + `dev`
- If no hours can be parsed, set `{ total: null, meeting: null, dev: null }`

Build a date entry: `{ "memberName": { total, meeting, dev }, ... }` for each target date.

### Step 6: Merge into rawData and regenerate issues

For each target date with parsed data:
- Add the date entry to `rawData` (do NOT overwrite existing dates)

After merging, regenerate the `issues` array using the same rules as `/fetch-daily-updates` Step 5, based on the **full updated rawData**. Use the leave map from Step 3. The latest date in rawData is treated as "today" for issue evaluation:

| Priority | Condition | Severity | Text template |
|----------|-----------|----------|---------------|
| 1 | Member has null data AND date is within a leave range | 🟠 | "休假 {start}-{end}" or "休假 {date}" (single day) |
| 2 | Member has null data for 2+ consecutive workdays (excluding leave days) | 🔴 | "連續 N 天未回報" |
| 3 | Member not reported on latest date (NOT on leave) | 🔴 | "未回報 M/D" |
| 4 | Member total > 10hr | 🟡 | "超時 {total}hr" |
| 5 | Member total < 5hr (non-null) | 🟡 | "工時偏低 {total}hr" |
| 6 | Meeting % > 50% | 🟡 | "會議佔比 {pct}%" |
| 7 | Member improved from < 6hr to >= 6.5hr | 🟢 | "改善 {prev}→{curr}hr" |
| 8 | Member stable at >= 7hr | 🟢 | "穩定 {total}hr" |

**Leave-aware logic:**
- **Date-in-range check**: Parse M/D strings to compare numerically: `start <= date <= end` (same year assumed)
- Leave days do NOT count toward "連續 N 天未回報" streak
- If a member is on leave for the latest date, emit 🟠 instead of 🔴

### Step 7: Write, validate, and confirm

1. Write updated `raw_data.json`
2. Run `npm test` to verify schema validation passes
3. Show a summary table:

```
日期       | 狀態      | 補到人數 | 備註
-----------|----------|---------|--------
3/3（一）  | 成功      | 10/12   | 日銜、哲緯 未回報
3/5（三）  | 成功      | 12/12   |
3/6（四）  | 未找到    |  —      | Chat 中無對應 thread
```

4. Ask user to confirm, then:
```
git add raw_data.json
git commit -m "Backfill daily data for M/D, M/D"
git push
```

## Notes

- Google Chat API `messages.list` does NOT support text-based filtering. Must fetch and filter client-side.
- Messages are in Traditional Chinese. Hour patterns: `(1hr)`, `(1H)`, `(1 hour)`, `(1小時)`, `（1.5H）`.
- Both halfwidth `()` and fullwidth `（）` parentheses are used.
- Always preserve existing data — this is append-only for `rawData`.
- After backfilling, always regenerate the `issues` array based on the full updated rawData to keep warnings consistent with actual data.
- Multiple target dates share the same fetched message batch for efficiency.
- Leave announcements are standalone threads in the same space. They are already included in the Step 3 fetch results — no extra API call needed.
- A member may have multiple leave entries. Check all ranges when determining if a date falls within leave.
- If a sender of a leave message is not in `memberMap`, skip it silently.
