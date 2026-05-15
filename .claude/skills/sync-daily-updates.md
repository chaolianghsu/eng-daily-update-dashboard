---
description: Sync daily updates from Google Chat — fetches work hour reports from one or more spaces (one per center) in parallel, parses hours/leave, merges into raw_data.json, validates, commits, pushes, updates Sheets. Use for daily-update-only sync ('同步日報', '抓 Chat 資料'), not when GitLab sync is also needed.
user_invocable: true
---

# Sync Daily Updates

Fully automated: fetch daily updates from every Google Chat space defined in `chat-config.json` (one per center) in parallel, parse, merge, update `raw_data.json`, commit, push, and write structured data to Google Sheets.

Replaces `/fetch-daily-updates` and `/backfill-daily-updates`. Supersedes the legacy single-space workflow.

## Prerequisites

- `chat-config.json` exists with `spaces[]` (each: `spaceId`, `center`, `memberMap`). Optional `centers` block scopes reporting members per center. Legacy single-space shape (`spaceId` + `memberMap` at top level) is still accepted via `normalizeChatConfig`.
- `public/raw_data.json` exists with current data
- Git remote is configured for push
- `claude` CLI installed (required for Step 3.5 LLM fallback; if missing, Step 3.5 is skipped)

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

If the DGPA CSV fetch fails (404 or empty — common when the yearly URL changes), fallback: treat Mon–Fri as workday, Sat–Sun as holiday, and display "⚠️ DGPA CSV 抓取失敗，使用 Mon-Fri fallback。請更新 Step 0 的 CSV URL（https://data.gov.tw/dataset/14718）"。

**Note:** The CSV URL is for 2026 (民國115年). Update yearly when the government publishes the next year's calendar at https://data.gov.tw/dataset/14718.

### Step 1: Read existing data + spaces list

1. Read `chat-config.json` → get `spaces[]` and optional `centers`.
2. Read `public/raw_data.json` → existing data.
3. Display the spaces being synced:
   ```
   目前 spaces：
   - 工程 (spaces/AAQAQhmoRAk) — 14 members
   - 技發 (spaces/AAQAoGOA5AU) — 4 members
   ```
4. Display current leave entries:
   ```
   目前已知休假：
   - Jason: 3/5-3/11
   ```
   If no leave, display "目前無已知休假記錄".

### Step 2: Fetch messages from all spaces (parallel)

For each space in `chat-config.json` `spaces[]`, dispatch the fetch **in parallel** using `mcp__gws__chat_spaces_messages_list`. Use the `center` value as the filename suffix for readability:

```
params per space: { "parent": "<spaceId>", "pageSize": 100, "orderBy": "createTime desc" }
output path:      /tmp/chat-messages-<center>.json
```

Display per-space progress, e.g.:
```
🛰  Fetching 工程 (spaces/AAQAQhmoRAk)...
🛰  Fetching 技發 (spaces/AAQAoGOA5AU)...
✅ 工程: 100 messages → /tmp/chat-messages-工程.json
✅ 技發: 47 messages → /tmp/chat-messages-技發.json
```

If a result is too large and auto-saved to a file by the MCP layer, note that file path and treat it as the input for Step 3.

### Step 3: Parse messages per space (parallel)

Run the parser **in parallel** (one bash background job per space). Use `--space-id` to point each invocation at the correct space's memberMap and center-scoped reporting members:

```bash
node scripts/parse-daily-updates.js --space-id "spaces/AAQAQhmoRAk" /tmp/chat-messages-工程.json > /tmp/parsed-工程.json &
node scripts/parse-daily-updates.js --space-id "spaces/AAQAoGOA5AU" /tmp/chat-messages-技發.json > /tmp/parsed-技發.json &
wait
```

`--space-id` accepts either the literal `spaceId` or the `center` name from `chat-config.json`. Without the flag the parser defaults to `spaces[0]` (legacy behavior — kept for backward compat).

### Step 3.5: LLM fallback for parse failures (per space)

For each parsed output, check whether any entries have `replied_no_hours` status. If any do AND `claude` CLI is available, run the LLM fallback per file:

```bash
for center in 工程 技發; do
  PARSED=/tmp/parsed-${center}.json
  MSGS=/tmp/chat-messages-${center}.json
  FAILURES=$(node -e "const d=require('$PARSED'); const f=[]; for(const[date,v] of Object.entries(d.dateEntries||{})){for(const[m,e] of Object.entries(v.entry||v)){if(e.status==='replied_no_hours')f.push(m+' '+date)}} if(f.length)console.log(f.join(', ')); else console.log('none')")
  echo "[$center] Parse failures: $FAILURES"
  if [ "$FAILURES" != "none" ] && command -v claude >/dev/null 2>&1; then
    node scripts/llm-reparse-failures.js "$PARSED" "$MSGS" \
      | claude --print --model haiku > /tmp/llm-reparse-${center}.json
    node scripts/merge-parse-results.js "$PARSED" /tmp/llm-reparse-${center}.json > /tmp/parsed-${center}-repaired.json
    mv /tmp/parsed-${center}-repaired.json "$PARSED"
  fi
done
```

If `claude` CLI is missing, skip and continue with the original parsed output.

### Step 4: Merge data (sequential, per space)

Merge each parsed output into `public/raw_data.json` **one at a time, in the order spaces appear in `chat-config.json`**. Sequential is required because merging is not commutative when both `addedToExisting` and `backfilled` are involved.

```bash
# Start from current raw_data.json
cp public/raw_data.json /tmp/merge-in.json

for center in 工程 技發; do
  node scripts/merge-daily-data.js /tmp/merge-in.json /tmp/parsed-${center}.json chat-config.json > /tmp/merged-${center}.json
  cp /tmp/merged-${center}.json /tmp/merge-in.json
done

cp /tmp/merge-in.json /tmp/merged-data.json
```

(If `chat-config.json` doesn't exist locally — gitignored — drop the third arg; centers/validCodes from existing data will be preserved.)

### Step 5: Review and apply

Each merge output carries three change arrays:
- `newDates` — dates not yet in raw_data.json (whole entry added)
- `backfilled` — existing dates where null entries were updated with actual data
- `addedToExisting` — existing dates where a member from another space was added

Issues are automatically recalculated when any of the three has entries.

1. Inspect the final merge output:
   ```bash
   node -e "const d=require('/tmp/merged-data.json'); console.log('New dates:', d.newDates); console.log('Backfilled:', d.backfilled); console.log('Added to existing:', d.addedToExisting);"
   ```
2. If **any** of the three arrays has entries, copy merged data to `public/raw_data.json`:
   ```bash
   cp /tmp/merged-data.json public/raw_data.json
   ```
3. If all three are empty, display "沒有新的資料需要更新", send no-data notification (Step 10), and stop.

### Step 6: Validate

```bash
bun run test
```

All tests must pass before proceeding.

### Step 7: Commit and push

```bash
git add public/raw_data.json
git commit -m "Update daily data for <dates> (<centers>)"
git push
```

Replace `<dates>` with a summary of changes and `<centers>` with the centers that contributed new data:
- One center: "Update daily data for 5/14 (工程)"
- Multiple centers: "Update daily data for 5/14 (工程, 技發)"
- Backfill only: "Update daily data for 5/13 backfill (技發)"

### Step 8: Update Google Sheets via Apps Script

POST the merged data to the Apps Script web app, which writes to the Spreadsheet's rawData/issues/leave/daily update sheets.

```bash
# Two-step POST (Apps Script returns 302 redirect):
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @public/raw_data.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)

curl -s "$REDIRECT_URL"
```

Expected response: `{"status":"ok","dates":N}`

The Apps Script web app also serves the Dashboard at the same URL (GET request).
Dashboard URL: https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec

### Step 9: Output summary (per center)

Show per-center stats. Use `centers[name].members` from `chat-config.json` (or `raw_data.json`'s `centers` block) to compute the denominator. Skip centers with no changes.

```
✅ Sync 完成
工程: 新增 5/14 (12/12 回報)
技發: 無新資料 (Richard、Patty 已回報 5/13)
Warnings: 無
raw_data.json 已 commit + push
```

If a center had backfills or added-to-existing entries, mention them:
```
技發: 補登 5/13 (Patty)
工程: 新增 5/14 (12/12 回報)
```

### Step 10: Send Google Chat notification

Show the notification message preview and ask: **"要發送 Chat 通知嗎？"**
Only send if the user explicitly confirms. If declined, skip this step. (See memory note: chat notifications require explicit user confirmation.)

Send notifications **per-space** — each space gets its own targeted message via `mcp__gws__chat_spaces_messages_create` (target = that space's `spaceId`). Include the per-center breakdown.

**On successful sync (new dates):**
```
📊 Daily Update Sync 完成
日期：<today M/D>（<weekday>）
<工程: 新增 5/14 (12/12 回報)>
<技發: 無新資料 (Richard、Patty 已回報 5/13)>
需關注：<attention issues or "無">
穩定：<stable member names>
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
📋 Sheets Dashboard：https://script.google.com/a/macros/big-data.com.tw/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec
```

**On successful sync (backfill / added-to-existing only):**
```
📊 Daily Update Sync 完成（補登）
日期：<today M/D>（<weekday>）
更新：<date> <member> 補回報（<total>hr）[, ...]
需關注：<attention issues or "無">
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
```

**On successful sync (both new dates + backfill):** Combine both.

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

## Gotchas

- **Thread date ≠ content date.** "3/6 Daily Update" thread contains 3/5 progress. The parse script handles this, but if you're manually inspecting Chat messages, don't assume the thread title date matches the data date.
- **Google Chat API has no text filtering** — must fetch all messages and filter client-side. Large spaces return many irrelevant messages; the parse script handles this.
- **DGPA CSV URL changes yearly.** The URL in Step 0 is for 2026 (民國115年). When it 404s in January, update from https://data.gov.tw/dataset/14718.
- **Apps Script POST returns 302.** Must follow the redirect with a second curl. A single curl without `-L` will silently fail (returns HTML, not JSON).
- **Merge is sequential, not parallel.** Step 4 must run one space at a time because `addedToExisting` from space N may change the shape that space N+1 backfills against. Parsing is parallel; merging is not.
- **Members not in a space's `memberMap` are silently skipped.** If a new team member's messages aren't being parsed, check the right space's `memberMap` in `chat-config.json`.
- **Cross-center pollution.** Always pass `--space-id` to the parser. Without it, the parser defaults to `spaces[0]` and may infer reporting members from the wrong center.

## Notes

- All parsing rules are in `scripts/parse-daily-updates.js`.
- Leave detection is automatic from Chat messages containing 請假/休假, per space.
- Leave sources (merged in order): `public/raw_data.json` leave → auto-detected from Chat → CLI `--leave`.
- Raw daily update text (原始內容) is written to the "daily update" sheet via `dailyUpdates` in the POST payload. Deduplication is by date+member.
- Per-space parallelism uses bash background jobs (`&` + `wait`) — no new deps.
