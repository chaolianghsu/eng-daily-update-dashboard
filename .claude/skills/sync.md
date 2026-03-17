---
description: Sync all — 3-stage DAG: daily updates + GitLab commits (parallel) → consistency analysis → task analysis
user_invocable: true
---

# Sync All

Three-stage DAG pipeline: parallel data collection → consistency analysis → task analysis.

## Workflow

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
node scripts/collect-gitlab-commits.js --date <date> > /tmp/sync-$(date +%s)-commits.json 2>/tmp/sync-gitlab-stderr.txt
```
- If no date argument, use previous workday
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
node scripts/prepare-task-analysis.js --date <date-range> | claude --print -m haiku > /tmp/sync-task-analysis.json 2>/dev/null
```

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

Send combined notification to Google Chat (same spaceId from chat-config.json):

```
📊 Sync All 完成（<today M/D>）
新增日期：<dates>
回報率：<N>/<M>
Commits：<N>
一致性：✅ <n> ⚠️ <n> 🔴 <n>
需關注：<attention issues or "無">
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
```
