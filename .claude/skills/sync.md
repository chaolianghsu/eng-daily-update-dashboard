# Sync All

Run daily update sync and GitLab commits sync together.

## Workflow

### Step 1: Run both syncs in parallel

Execute `/sync-daily-updates` and `/sync-gitlab-commits` using the Agent tool:
- One as foreground agent
- One as background agent with `run_in_background: true`

### Step 2: Wait for both to complete

Monitor progress messages from both agents.

### Step 3: Combined summary

After both complete, display a unified summary:

```
✅ Sync All 完成

Daily Updates:
  新增日期：<dates>
  回報率：<N>/<M>

GitLab Commits:
  Commits：<N>
  一致性：✅ <n> ⚠️ <n> 🔴 <n>

成員總覽：
  成員    | Commits | 工時  | 狀態
  Joyce  | 11      | 10.5  | ✅
  Ted    | 8       | 7.5   | ✅
  ...
```
