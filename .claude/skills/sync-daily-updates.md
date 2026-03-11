# Sync Daily Updates

Fully automated: fetch daily updates from Google Chat, parse, merge with existing data, update raw_data.json, commit, push, and write structured data to Google Sheets.

Replaces `/fetch-daily-updates` and `/backfill-daily-updates`.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap`
- `raw_data.json` exists with current data
- Git remote is configured for push

## Workflow

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

1. Compare `/tmp/merged-data.json` with `raw_data.json`:
   - How many new dates were added?
   - Any warnings from the parsed output?
2. If new data exists, copy merged data to `raw_data.json`:
   ```bash
   cp /tmp/merged-data.json raw_data.json
   ```
3. If no new data, display "沒有新的資料需要更新" and stop.

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

Replace `<dates>` with the actual new dates added (e.g., "3/9, 3/10").

### Step 8: Update Google Sheets via Apps Script

POST the merged data to the Apps Script web app, which writes to the Spreadsheet's rawData/issues/leave/daily update sheets.

```bash
# Two-step POST (Apps Script returns 302 redirect):
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @raw_data.json \
  "https://script.google.com/macros/s/AKfycbwROAe-v_4TZTkwNxmKJzP7WI4IDV897iu3VN6_7BIn8cJHFY1g8adknZrnErDYvEI/exec" 2>/dev/null)

curl -s "$REDIRECT_URL"
```

Expected response: `{"status":"ok","dates":N}`

The Apps Script web app also serves the Dashboard at the same URL (GET request).
Dashboard URL: https://script.google.com/macros/s/AKfycbwROAe-v_4TZTkwNxmKJzP7WI4IDV897iu3VN6_7BIn8cJHFY1g8adknZrnErDYvEI/exec

### Step 9: Output summary

```
✅ Sync 完成
新增日期：3/9, 3/10
回報人數：11/12
Warnings：無
raw_data.json 已 commit + push
```

## Notes

- Idempotent: running multiple times won't duplicate data (merge script skips existing dates).
- Thread date ≠ content date. "3/6 Daily Update" thread contains 3/5 progress.
- All parsing rules are in `scripts/parse-daily-updates.js`.
- Leave detection is automatic from Chat messages containing 請假/休假.
- Leave sources (merged in order): `raw_data.json` leave → auto-detected from Chat → CLI --leave.
- Google Chat API does NOT support text filtering — must fetch and filter client-side.
- Members not in `memberMap` are skipped.
- Raw daily update text (原始內容) is written to the "daily update" sheet via `dailyUpdates` in the POST payload. Deduplication is by date+member.
