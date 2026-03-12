# Sync Daily Updates

Fully automated: fetch daily updates from Google Chat, parse, merge with existing data, update raw_data.json, commit, push, and write structured data to Google Sheets.

Replaces `/fetch-daily-updates` and `/backfill-daily-updates`.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap`
- `raw_data.json` exists with current data
- Git remote is configured for push

## Workflow

### Step 0: Check if today is a workday

Fetch the Taiwan DGPA (行政院人事行政總處) official work calendar to determine if today is a workday.

```bash
curl -s "https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv" -o /tmp/dgpa-calendar.csv
```

Parse the CSV and find today's row by `YYYYMMDD` date key:
- Column format: `西元日期,星期,是否放假,備註`
- `是否放假` = `0` → workday, `2` → holiday/weekend

If today is a holiday (`是否放假 === "2"`):
1. Display: "今天是 [備註 or 週末]，跳過 sync"
2. Send holiday skip notification (see Step 10)
3. Stop — do not proceed to Step 1

If the DGPA CSV fetch fails, fallback: treat Mon–Fri as workday, Sat–Sun as holiday.

**Note:** The CSV URL is for 2026 (民國115年). Update yearly when the government publishes the next year's calendar at https://data.gov.tw/dataset/14718.

### Step 1: Read existing data and leave

1. Read `chat-config.json` → get `spaceId`, `memberMap`
2. Read `raw_data.json` → existing data
3. Display current leave entries:
   ```
   目前已知休假：
   - Jason: 3/5-3/11
   ```
   If no leave, display "目前無已知休假記錄".

### Step 2: Fetch messages from Google Chat

Use `mcp__gws__chat_spaces_messages_list`:

```
params: { "parent": "<spaceId>", "pageSize": 100, "orderBy": "createTime desc" }
```

Save the result to a temp file (e.g., `/tmp/chat-messages.json`).
If the result is too large and auto-saved to a file, note that file path.

### Step 3: Parse messages

```bash
node scripts/parse-daily-updates.js /tmp/chat-messages.json
```

Save output to `/tmp/parsed-output.json`.

### Step 4: Merge data

```bash
node scripts/merge-daily-data.js raw_data.json /tmp/parsed-output.json > /tmp/merged-data.json
```

### Step 5: Review and apply

The merge script auto-detects two types of changes:
- **New dates** (`newDates`): dates not yet in raw_data.json
- **Backfills** (`backfilled`): existing dates where null entries are updated with actual data (e.g., late reporters)

Issues are automatically recalculated when any changes are detected.

1. Read the merge output and check `newDates` and `backfilled` arrays:
   ```bash
   node -e "const d=require('/tmp/merged-data.json'); console.log('New dates:', d.newDates); console.log('Backfilled:', d.backfilled);"
   ```
2. If either has entries, copy merged data to `raw_data.json`:
   ```bash
   cp /tmp/merged-data.json raw_data.json
   ```
3. If both are empty, display "沒有新的資料需要更新", send no-data notification (Step 10), and stop.

### Step 6: Validate

```bash
npm test
```

All tests must pass before proceeding.

### Step 7: Commit and push

```bash
git add raw_data.json
git commit -m "Update daily data for <dates>"
git push
```

Replace `<dates>` with a summary of changes:
- New dates: "3/9, 3/10"
- Backfills only: "3/11 (Ted backfill)"
- Both: "3/12, 3/11 (Ted backfill)"

### Step 8: Update Google Sheets via Apps Script

POST the merged data to the Apps Script web app, which writes to the Spreadsheet's rawData/issues/leave/daily update sheets.

```bash
# Two-step POST (Apps Script returns 302 redirect):
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @raw_data.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)

curl -s "$REDIRECT_URL"
```

Expected response: `{"status":"ok","dates":N}`

The Apps Script web app also serves the Dashboard at the same URL (GET request).
Dashboard URL: https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec

### Step 9: Output summary

```
✅ Sync 完成
新增日期：3/9, 3/10
回報人數：11/12
Warnings：無
raw_data.json 已 commit + push
```

### Step 10: Send Google Chat notification

Read `spaceId` from `chat-config.json`. Send a summary message to the Google Chat space using `mcp__gws__chat_spaces_messages_create`.

**On successful sync (new dates):**
```
📊 Daily Update Sync 完成
日期：<today M/D>（<weekday>）
新增日期：<new dates>
回報率：<N>/<M>
需關注：<attention issues or "無">
穩定：<stable member names>
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
📋 Sheets Dashboard：https://script.google.com/a/macros/big-data.com.tw/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec
```

**On successful sync (backfill only):**
```
📊 Daily Update Sync 完成（補登）
日期：<today M/D>（<weekday>）
更新：<date> <member> 補回報（<total>hr）[, ...]
回報率：<N>/<M>
需關注：<attention issues or "無">
穩定：<stable member names>
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
📋 Sheets Dashboard：https://script.google.com/a/macros/big-data.com.tw/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec
```

**On successful sync (both new dates + backfill):**
Combine both: show 新增日期 and 更新 lines.

**On holiday skip (from Step 0):**
```
📅 今天是 <holiday name>，跳過 sync
```

**On no new data (from Step 5):**
```
📊 Sync 檢查完成，沒有新資料（<today M/D>）
```

**On failure:**
```
❌ Sync 失敗：<error description>
```

## Scheduling

Run with Claude Code `/loop` in a tmux session:

```bash
# Create persistent session
tmux new-session -d -s daily-sync
tmux send-keys -t daily-sync 'cd ~/Projects/eng-daily-update-dashboard && claude' Enter
# Start at 11:00 on a workday, repeats every 24h
tmux send-keys -t daily-sync '/loop 24h /sync-daily-updates' Enter
```

Recovery after machine restart: `tmux attach -t daily-sync` or re-run above.

## Notes

- Idempotent: running multiple times won't duplicate data (merge script skips existing dates).
- Thread date ≠ content date. "3/6 Daily Update" thread contains 3/5 progress.
- All parsing rules are in `scripts/parse-daily-updates.js`.
- Leave detection is automatic from Chat messages containing 請假/休假.
- Leave sources (merged in order): `raw_data.json` leave → auto-detected from Chat → CLI --leave.
- Google Chat API does NOT support text filtering — must fetch and filter client-side.
- Members not in `memberMap` are skipped.
- Raw daily update text (原始內容) is written to the "daily update" sheet via `dailyUpdates` in the POST payload. Deduplication is by date+member.
