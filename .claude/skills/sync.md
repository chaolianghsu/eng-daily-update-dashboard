# Sync All

Run daily update sync first, then GitLab commits sync.

**IMPORTANT:** Daily updates MUST complete before GitLab sync starts. GitLab sync reads `public/raw_data.json` for consistency analysis (hours vs commits). If it runs before daily updates are merged, all hours will be null and every member will show 🔴.

## Workflow

### Step 1: Run daily updates sync first

Execute `/sync-daily-updates` as a foreground agent. Wait for it to complete.

### Step 2: Run GitLab commits sync

After Step 1 completes, execute `/sync-gitlab-commits` as a foreground agent.

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
