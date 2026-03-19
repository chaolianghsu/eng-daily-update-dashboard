---
description: Sync all data — 3-stage DAG pipeline: (1) daily updates + GitLab commits in parallel, (2) consistency analysis, (3) AI task reasonableness analysis. Use for full daily sync ('同步全部', '同步', 'sync'), or when no specific sync target is mentioned.
user_invocable: true
---

# Sync All

Three-stage DAG pipeline: parallel data collection → consistency analysis → task analysis.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap` (for Stage 1 daily updates)
- `gitlab-config.json` exists with `baseUrl`, `token`, `memberMap`, `excludeAuthors` (for Stage 1 GitLab)
- `public/raw_data.json` exists with current data
- `claude` CLI available on PATH (for Stage 3; gracefully skipped if missing)
- Git remote is configured for push

## Workflow

**Date logic:** If `/sync` is invoked without a date argument, default to previous workday (Mon–Fri; Mon for weekend runs). This date is used for GitLab collection (Stage 1) and task analysis (Stage 3).

### Stage 1: 平行收集

Display:
```
⏳ Stage 1 — 平行收集
```

Execute two agents in parallel:

**Agent A (background):** Run `/sync-daily-updates` skill. When complete, capture:
- New dates added
- Reporting rate (N/M)
- Any issues/warnings

**Agent B (foreground or background):** Collect GitLab commits without analysis:
```bash
node scripts/collect-gitlab-commits.js --date <M/D> > /tmp/sync-$(date +%s)-commits.json 2>/tmp/sync-gitlab-stderr.txt
```
- `<M/D>` = target date from date logic above (e.g., `3/17`)
- Save the commits JSON path for Stage 2

Wait for both agents to complete. Display per-agent results:
```
✅ Stage 1 — 平行收集 (Xs)
  📊 Daily Updates     ✅ 3/16 (10/12 回報)
  🔀 GitLab Commits    ✅ 93 commits collected
```

**Error handling:**
- If daily updates fails but GitLab succeeds → proceed to Stage 2 with existing raw_data.json, display warning
- If GitLab fails but daily updates succeeds → skip Stage 2 and 3, only commit daily update results
- If both fail → abort with error

### Stage 2: 一致性分析

Display:
```
⏳ Stage 2 — 一致性分析
```

Run analysis using the commits from Stage 1:
```bash
node scripts/analyze-consistency.js --commits /tmp/sync-<timestamp>-commits.json > /tmp/sync-analysis-output.json 2>/tmp/sync-analysis-stderr.txt
```

This script:
1. Reads `public/raw_data.json` (updated by Stage 1 Agent A)
2. Reads the commits JSON from Stage 1 Agent B
3. Writes merged `public/gitlab-commits.json`
4. Outputs POST payload to stdout

Then:
1. Review stderr for per-date analysis summary
2. Commit and push `public/gitlab-commits.json`
3. POST the output to Google Sheets:
```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @/tmp/sync-analysis-output.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)
curl -s "$REDIRECT_URL"
```

Display:
```
✅ Stage 2 — 一致性分析 (Xs)
  3/16: ✅ 8  ⚠️ 2  🔴 0
```

### Stage 3: 任務合理性（自動）

Display:
```
⏳ Stage 3 — 任務合理性
```

Run automated task analysis:
```bash
node scripts/prepare-task-analysis.js --date <M/D> | claude --print -m haiku > /tmp/sync-task-analysis.json 2>/dev/null
```

`<M/D>` = same target date as Stage 1. The script determines the analysis window internally.

If successful:
1. Validate the output is valid JSON
2. Copy to `public/task-analysis.json`
3. Commit and push
4. POST to Google Sheets:
```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"taskAnalysis\": $(cat public/task-analysis.json)}" \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)
curl -s "$REDIRECT_URL"
```

Display:
```
✅ Stage 3 — 任務合理性 (Xs)
  🔴 日銜 3/16 — 5H 開發, 0 commits
  🟡 Jason 3/16 — 7H/4 commits
```

**Fallback:** If `claude` CLI is not available or fails:
```
⚠️ Stage 3 — 跳過（claude CLI 不可用）
  手動執行: node scripts/prepare-task-analysis.js --date <range>
```

### Final Summary

```
✅ Sync All 完成 (Xs)

Daily Updates:
  新增日期：<dates>
  回報率：<N>/<M>

GitLab Commits:
  Commits：<N>
  一致性：✅ <n> ⚠️ <n> 🔴 <n>

Task Analysis:
  警示：<N> (🔴 <n> 🟡 <n>)

成員總覽：
  成員    | Commits | 工時  | 狀態
  Joyce  | 31      | 9     | ✅
  Ted    | 1       | 8     | ✅
  日銜   | 0       | 6.5   | ⚠️
  ...
```

### Google Chat Notification

Show the notification message preview and ask: **"要發送 Chat 通知嗎？"**
Only send if the user explicitly confirms. If declined, skip silently.

If confirmed, send to Google Chat (spaceId from chat-config.json) via `mcp__gws__chat_spaces_messages_create`:

```
📊 Sync All 完成（<today M/D>）
新增日期：<dates>
回報率：<N>/<M>
Commits：<N>
一致性：✅ <n> ⚠️ <n> 🔴 <n>
需關注：<attention issues or "無">
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
```

## Gotchas

- **Stage 2 depends on Stage 1's tmp file path.** The commits JSON path from `collect-gitlab-commits.js` must be passed exactly to `analyze-consistency.js`. Use the timestamped filename pattern (`/tmp/sync-$(date +%s)-commits.json`) to avoid collisions with concurrent runs.
- **`claude --print` may output non-JSON.** Stage 3 pipes to `claude --print -m haiku`, which can occasionally produce preamble text before the JSON. Always validate the output is valid JSON before copying to `public/task-analysis.json`.
- **Stage 1 Agent A modifies `public/raw_data.json` in-place.** Stage 2 reads this file. If Agent A fails mid-write, Stage 2 gets corrupted input. The error handling paths (daily fails → use existing raw_data.json) account for this.
- **Apps Script POST returns 302.** All three POST steps (daily updates, commits, task analysis) require following the redirect with a second curl call.
- **Parallel agent timing.** Agent A (daily updates) involves MCP calls and may take longer than Agent B (GitLab collection). Stage 2 must wait for both — don't proceed on partial results.
