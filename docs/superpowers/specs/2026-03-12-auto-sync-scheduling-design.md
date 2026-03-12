# Auto Sync Scheduling Design

## Overview

Automate `/sync-daily-updates` to run daily at 11:00 on Taiwan workdays using Claude Code `/loop` in a tmux session, with Google Chat notification after each run.

## Workday Detection

### Data Source
Taiwan DGPA (行政院人事行政總處) official work calendar CSV.
- URL (2026/115年): `https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv`
- Dataset page: `https://data.gov.tw/dataset/14718`

### CSV Format
```
西元日期,星期,是否放假,備註
20260101,四,2,開國紀念日
20260102,五,0,
```
- `是否放假`: `0` = workday, `2` = holiday/weekend
- `備註`: holiday name (empty for regular days)

### Detection Logic (sync skill Step 0)
1. Fetch DGPA CSV
2. Find today's row by `YYYYMMDD` key
3. If `是否放假 === "2"` → skip, send holiday notification, stop
4. If `是否放假 === "0"` → proceed with sync
5. **Fallback** (API failure): treat Mon-Fri as workday, Sat-Sun as holiday

Covers: weekends, national holidays, 彈性放假, 補班日 — all in one check.

## Notification

### Channel
Send to Google Chat space via `mcp__gws__chat_spaces_messages_create` using `spaceId` from `chat-config.json`.

### Success Message
```
📊 Daily Update Sync 完成
日期：M/D（星期）
新增日期：M/D, M/D
回報率：N/M
需關注：[attention issues]
穩定：[stable members]
```

### Holiday Skip Message
```
📅 今天是 [holiday name]，跳過 sync
```

### Failure Message
```
❌ Sync 失敗：[error description]
```

## Execution Setup

### tmux + /loop
```bash
# Create persistent session
tmux new-session -d -s daily-sync

# Start Claude Code
tmux send-keys -t daily-sync 'cd ~/Projects/eng-daily-update-dashboard && claude' Enter

# Start 24h loop (first run at 11:00 on a workday)
tmux send-keys -t daily-sync '/loop 24h /sync-daily-updates' Enter
```

### Recovery
- Machine restart: `tmux attach -t daily-sync` to check status
- Session dead: re-run setup steps above
- Optional: add tmux auto-start to shell profile or launchd

## Sync Skill Changes

### Modified Flow
```
Step 0:  Check workday (DGPA CSV) → skip if holiday
Step 1:  Read existing data and leave (unchanged)
Step 2:  Fetch messages from Google Chat (unchanged)
Step 3:  Parse messages (unchanged)
Step 4:  Merge data (unchanged)
Step 5:  Review and apply (unchanged)
Step 6:  Validate — npm test (unchanged)
Step 7:  Commit and push (unchanged)
Step 8:  Update Google Sheets (unchanged)
Step 9:  Output summary (unchanged)
Step 10: Send Google Chat notification (NEW)
```

### Files Modified
- `.claude/skills/sync-daily-updates.md`: add Step 0 (workday check) and Step 10 (notification)

### Yearly Maintenance
Update DGPA CSV URL once per year when the government publishes the next year's calendar (typically Oct-Nov).
