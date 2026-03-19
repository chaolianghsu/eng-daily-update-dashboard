---
description: Sync GitLab commits — fetches commits from self-hosted GitLab, maps authors to team members, analyzes consistency with daily updates, updates local JSON + Google Sheets. Supports single date or date range backfill (e.g., 3/9-3/12). Use for GitLab-only sync ('同步 commits', '抓 GitLab'), or to backfill missing commit data.
user_invocable: true
---

# Sync GitLab Commits

Fetch GitLab commits for the engineering team and update Google Spreadsheet. Also used for backfilling historical data.

## Usage

```
/sync-gitlab-commits          # previous workday (default)
/sync-gitlab-commits 3/11     # specific date
/sync-gitlab-commits 3/9-3/12 # date range (backfill)
```

## Prerequisites

- `gitlab-config.json` exists with `baseUrl`, `token`, `memberMap`, `excludeAuthors`
- `public/raw_data.json` exists with current data
- Git remote is configured for push

## Workflow

### Step 1: Read config

Read `gitlab-config.json` to confirm settings exist. Verify it has `baseUrl`, `token`, `memberMap`, and `excludeAuthors` fields.

### Step 2: Determine date and detect gaps

If no date argument provided, default to previous workday (Mon–Fri; Mon for weekend runs).
User can specify: `/sync-gitlab-commits 3/11` or `/sync-gitlab-commits 3/9-3/12`

**Auto-detect gaps:** Compare dates in `public/raw_data.json` vs `public/gitlab-commits.json`. If there are daily update dates without GitLab data, display:
```
⚠️ 偵測到缺口：以下日期有 daily update 但無 GitLab commits
  2/23, 2/24, 2/25, 2/26, 2/27, 3/2, 3/3
  要補抓嗎？(y/n)
```
If user confirms, use the gap range as the date argument.

### Step 3: Fetch and analyze

```bash
node scripts/fetch-gitlab-commits.js --date <date> > /tmp/gitlab-commits-output.json 2>/tmp/gitlab-commits-stderr.txt
```

Review stderr for progress and warnings:

```bash
cat /tmp/gitlab-commits-stderr.txt
```

### Step 4: Review output

```bash
node -e "const d=require('/tmp/gitlab-commits-output.json'); console.log('Commits:', d.gitlabCommits.length, 'Members:', Object.keys(d.summary).length)"
```

Display a summary of commits per member and any unmapped author warnings from stderr.

### Step 5: POST to Google Sheets

```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @/tmp/gitlab-commits-output.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)

curl -s "$REDIRECT_URL"
```

Expected: `{"status":"ok","commits":N}`

### Step 6: Commit public/gitlab-commits.json

```bash
git add public/gitlab-commits.json
git commit -m "Update GitLab commits data for <date>"
git push
```

Replace `<date>` with the date or date range used (e.g., "3/11" or "3/9-3/12").

### Step 7: Output summary

```
✅ GitLab Commits Sync 完成
日期：<date>
Commits：<N>
成員：<member list with counts>
一致性：✅ <n> ⚠️ <n> 🔴 <n>
```

### Step 8: Send Google Chat notification

Show the summary from Step 7 and ask: **"要發送 Chat 通知嗎？"**
Only send if the user explicitly confirms. If declined, skip this step.

If confirmed, read `spaceId` from `chat-config.json` and send via `mcp__gws__chat_spaces_messages_create`:
```
🔀 GitLab Commits Sync 完成（<date>）
Commits：<N>
一致性：✅ <n> ⚠️ <n> 🔴 <n>
需關注：<attention items or "無">
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
```

## Gotchas

- **Unmapped authors are silently dropped.** Some members use multiple git names (e.g., `byron.you`, `Byron.you`, `游日銜`). If a member shows 0 commits unexpectedly, check stderr for unmapped author warnings and update `gitlab-config.json` memberMap.
- **GitLab API token expiration.** The PAT in `gitlab-config.json` expires periodically. Symptom: 401 errors in stderr. Regenerate at GitLab → Settings → Access Tokens with `read_api` scope.
- **Apps Script POST returns 302.** Must follow the redirect with a second curl. A single curl without `-L` returns HTML, not JSON.
- **Gap detection compares raw_data.json vs gitlab-commits.json dates** — it surfaces dates where daily updates exist but GitLab data is missing, so you don't unknowingly have incomplete analysis. Confirm before backfilling large ranges (can be slow).
- **Idempotent and safe to re-run.** Google Sheets deduplicates by date|member|sha. Local JSON merges by date, preserving old dates.

## Notes

- The script writes `public/gitlab-commits.json` (for dashboard) and outputs the POST payload to stdout.
- Progress and warnings go to stderr.
- **Backfill:** Use date range to backfill historical data. The merge logic preserves existing dates, so re-running is safe.
- Commits are deduplicated by sha+project to prevent inflated counts.
