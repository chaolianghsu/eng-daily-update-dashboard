# Fetch Daily Updates from Google Chat

Fetch daily work hour reports from the Google Chat space and update `public/raw_data.json`.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap`
- `public/raw_data.json` exists with current data

## Workflow

### Step 1: Load config and check existing leave

1. Read `chat-config.json` → get `spaceId`
2. Read `public/raw_data.json` → check `leave` section
3. Display current leave entries to operator:
   ```
   目前已知休假：
   - Jason: 3/5-3/11
   ```
   If no leave entries, display "目前無已知休假記錄".

### Step 2: Fetch messages from Chat

Use `mcp__gws__chat_spaces_messages_list`:

```
params: { parent: "<spaceId>", pageSize: 100, orderBy: "createTime desc" }
```

If the result is too large and saved to a file, note the file path.
If returned inline, save the JSON to a temp file (e.g., `/tmp/chat-messages.json`).

### Step 3: Run parsing script

```bash
node scripts/parse-daily-updates.js <messages-file> [--leave "Name:M/D-M/D"]
```

The script outputs JSON with:
- `leaveMap` — combined leave (public/raw_data.json + auto-detected from Chat + CLI `--leave`)
- `dateEntries` — parsed data per date, with `contentDate` vs `threadDate`
- `issues` — generated warnings
- `warnings` — members with null data but no leave detected (potential missed leave)

### Step 4: Review leave first

**Before reviewing daily update data, check leave completeness:**

1. Review `leaveMap` — does it include all known leaves for this month?
2. Review `warnings` — any member flagged as "資料為 null，未偵測到休假"?
3. If a leave is missing:
   - Add to `public/raw_data.json` `leave` section, OR
   - Re-run script with `--leave "Name:M/D-M/D"`

### Step 5: Review daily update data

- **Content date**: Thread "3/6 Daily Update" typically contains 3/5 progress. Verify `contentDate` is correct.
- **Already exists**: If `alreadyExists` is true, skip or compare.
- **Null hours**: Members with null may have reported but used unparseable format (e.g., bare `(6)`).

### Step 6: Merge and write

For each new date entry (where `alreadyExists` is false):
1. Add `entry` to `rawData` under the `contentDate` key
2. Replace `leave` with script-generated `leaveMap` (auto-persists detected leave)
3. Replace `issues` with script-generated issues
4. Write updated `public/raw_data.json`
5. Run `npm test` to verify

### Step 7: Confirm and commit

Show summary table, then:
```
git add public/raw_data.json
git commit -m "Update daily data for M/D"
git push
```

## Notes

- Thread date ≠ content date. "3/6 Daily Update" thread has 3/5 progress.
- Google Chat API does NOT support text filtering — must fetch and filter client-side.
- Members not in `memberMap` are skipped.
- All parsing rules, thresholds, and issue logic are in `scripts/parse-daily-updates.js`.
- Leave announcements are standalone threads containing 請假 or 休假. Member is identified via `sender.name` → `memberMap`, NOT from text (nicknames differ).
- Leave sources (merged in order): `public/raw_data.json` `leave` → auto-detected from Chat → CLI `--leave`. Use `public/raw_data.json` for leave not posted in Chat.
- Older leave announcements (beyond 100 messages) won't be auto-detected. Always verify `warnings` output.
