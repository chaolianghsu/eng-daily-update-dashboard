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

### Step 1: Load config and check existing leave

1. Read `chat-config.json` → `spaceId`, `memberMap`, `queryKeyword`
2. Read `raw_data.json` → existing `rawData`, `leave`
3. Display current leave entries to operator:
   ```
   目前已知休假：
   - Jason: 3/5-3/11
   ```
   If no leave entries, display "目前無已知休假記錄".

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

### Step 3: Fetch messages from Chat

Use `mcp__gws__chat_spaces_messages_list` with pagination (up to 5 pages × 100 messages):

```
params: { parent: "<spaceId>", pageSize: 100, orderBy: "createTime desc" }
```

Save all results to a file. If multiple pages, combine messages into one file or pass multiple files to the script.

### Step 4: Run parsing script

```bash
node scripts/parse-daily-updates.js <file1> [file2 ...] [--leave "Name:M/D-M/D"]
```

The script outputs:
- `leaveMap` — combined leave (raw_data.json + auto-detected from Chat + CLI `--leave`)
- `dateEntries` — parsed data per date
- `issues` — generated warnings
- `warnings` — members with null data but no leave detected

### Step 5: Review leave first

**Before reviewing daily update data, check leave completeness:**

1. Review `leaveMap` — does it include all known leaves for the target dates?
2. Review `warnings` — any member flagged as "資料為 null，未偵測到休假"?
3. If a leave is missing:
   - Add to `raw_data.json` `leave` section, OR
   - Re-run script with `--leave "Name:M/D-M/D"`

### Step 6: Match and merge

From script output:
- Match `dateEntries` to target dates (using `contentDate`)
- Skip dates marked `alreadyExists`
- For dates not found in any thread, mark as "未找到"
- Add matched entries to `rawData`
- Replace `leave` with script-generated `leaveMap` (auto-persists detected leave)
- Replace `issues` with script-generated issues

### Step 7: Write, validate, and confirm

1. Write `raw_data.json`
2. Run `npm test`
3. Show summary table:

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

- Thread date ≠ content date. "3/6 Daily Update" thread has 3/5 progress.
- All parsing rules, thresholds, and issue logic are in `scripts/parse-daily-updates.js`.
- Leave announcements are standalone threads containing 請假 or 休假. Detection uses `sender.name` → `memberMap`.
- Leave sources (merged in order): `raw_data.json` `leave` → auto-detected from Chat → CLI `--leave`.
- Older leave announcements (beyond fetched messages) won't be auto-detected. Always verify `warnings` output.
- Multiple target dates share the same fetched message batch for efficiency.
- Always preserve existing data — append-only for `rawData`.
