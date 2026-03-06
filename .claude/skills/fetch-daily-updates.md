# Fetch Daily Updates from Google Chat

Fetch daily work hour reports from the Google Chat space and update `raw_data.json`.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap`
- `raw_data.json` exists with current data

## Workflow

### Step 1: Load config

Read `chat-config.json` → get `spaceId`.

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

Use `--leave` for any known leave not posted in Chat (e.g., `--leave "Jason:3/5-3/11"`).

The script outputs JSON with:
- `dateEntries` — parsed data per date, with `contentDate` (actual data date) vs `threadDate` (thread title date)
- `leaveMap` — auto-detected + manual leave entries
- `issues` — generated warnings

### Step 4: Review output

- **Content date**: Thread "3/6 Daily Update" typically contains 3/5 progress. Verify `contentDate` is correct.
- **Already exists**: If `alreadyExists` is true, the date is already in rawData — skip or compare.
- **Null hours**: Check members with null — they may have reported but used unparseable format (e.g., bare `(6)` without H/hr suffix).
- **Leave gaps**: If a known leave is missing from `leaveMap`, re-run with `--leave`.

### Step 5: Merge and write

For each new date entry (where `alreadyExists` is false):
1. Add `entry` to `rawData` under the `contentDate` key
2. Replace `issues` with script-generated issues
3. Write updated `raw_data.json`
4. Run `npm test` to verify

### Step 6: Confirm and commit

Show summary table, then:
```
git add raw_data.json
git commit -m "Update daily data for M/D"
git push
```

## Notes

- Thread date ≠ content date. "3/6 Daily Update" thread has 3/5 progress.
- Google Chat API does NOT support text filtering — must fetch and filter client-side.
- Members not in `memberMap` are skipped.
- All parsing rules, thresholds, and issue logic are in `scripts/parse-daily-updates.js`.
- Leave announcements are standalone threads containing 請假 or 休假. Member is identified via `sender.name` → `memberMap`, NOT from text (nicknames differ).
