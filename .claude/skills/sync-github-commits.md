---
description: Sync GitHub commits — fetches commits from GitHub.com org, maps authors to team members, deduplicates against existing GitLab data by SHA, analyzes consistency with daily updates, updates local JSON + Google Sheets. Supports single date or date range backfill (e.g., 3/9-3/12). Use for GitHub-only sync ('同步 GitHub', '抓 GitHub'), or to backfill missing GitHub commit data.
user_invocable: true
---

# Sync GitHub Commits

Fetch GitHub commits for the engineering team and update Google Spreadsheet. Also used for backfilling historical data.

## Usage

```
/sync-github-commits          # previous workday (default)
/sync-github-commits 3/11     # specific date
/sync-github-commits 3/9-3/12 # date range (backfill)
```

## Prerequisites

- `github-config.json` exists with `baseUrl`, `org`, `token`, `memberMap`, `excludeAuthors`
- `public/raw_data.json` exists with current data
- Git remote is configured for push

## Workflow

### Step 1: Read config

Read `github-config.json` to confirm settings exist. Verify it has `baseUrl`, `org`, `token`, `memberMap`, and `excludeAuthors` fields.

### Step 2: Determine date and detect gaps

If no date argument provided, default to previous workday (Mon-Fri; Mon for weekend runs).
User can specify: `/sync-github-commits 3/11` or `/sync-github-commits 3/9-3/12`

**Auto-detect gaps:** Compare dates in `public/raw_data.json` vs `public/gitlab-commits.json`. If there are daily update dates without GitHub data, display:
```
⚠️ 偵測到缺口：以下日期有 daily update 但無 GitHub commits
  2/23, 2/24, 2/25, 2/26, 2/27, 3/2, 3/3
  要補抓嗎？(y/n)
```
If user confirms, use the gap range as the date argument.

### Step 3: Fetch and analyze

```bash
node scripts/fetch-github-commits.js --date <date> > /tmp/github-commits-output.json 2>/tmp/github-commits-stderr.txt
```

Review stderr for progress and warnings:

```bash
cat /tmp/github-commits-stderr.txt
```

### Step 4: Review output

```bash
node -e "const d=require('/tmp/github-commits-output.json'); console.log('Commits:', d.gitlabCommits.length, 'Members:', Object.keys(d.summary).length)"
```

Display a summary of commits per member and any unmapped author warnings from stderr.

### Step 5: POST to Google Sheets

```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @/tmp/github-commits-output.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)

curl -s "$REDIRECT_URL"
```

Expected: `{"status":"ok","commits":N}`

### Step 6: Commit public/gitlab-commits.json

```bash
git add public/gitlab-commits.json
git commit -m "Update GitHub commits data for <date>"
git push
```

Replace `<date>` with the date or date range used (e.g., "3/11" or "3/9-3/12").

### Step 7: Output summary

```
✅ GitHub Commits Sync 完成
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
🐙 GitHub Commits Sync 完成（<date>）
Commits：<N>
一致性：✅ <n> ⚠️ <n> 🔴 <n>
需關注：<attention items or "無">
📈 Dashboard：https://chaolianghsu.github.io/eng-daily-update-dashboard/
```

## Gotchas

- **Unmapped authors are silently dropped.** If a member shows 0 commits unexpectedly, check stderr for unmapped author warnings and update `github-config.json` memberMap.
- **GitHub API token expiration.** The PAT in `github-config.json` requires `repo` scope. Symptom: 401 errors in stderr. Regenerate at GitHub → Settings → Developer settings → Personal access tokens.
- **Apps Script POST returns 302.** Must follow the redirect with a second curl. A single curl without `-L` returns HTML, not JSON.
- **Gap detection compares raw_data.json vs gitlab-commits.json dates** — it surfaces dates where daily updates exist but commit data is missing, so you don't unknowingly have incomplete analysis. Confirm before backfilling large ranges (can be slow).
- **Idempotent and safe to re-run.** Google Sheets deduplicates by date|member|sha. Local JSON merges by date, preserving old dates.
- **Cross-platform SHA dedup.** `fetch-github-commits.js` deduplicates against existing GitLab data by `sha|project` key. Same commit mirrored on both platforms is counted once.

## Notes

- The script writes merged `public/gitlab-commits.json` (for dashboard) and outputs the POST payload to stdout.
- Progress and warnings go to stderr.
- **Backfill:** Use date range to backfill historical data. The merge logic preserves existing dates, so re-running is safe.
- Commits are deduplicated by sha+project across platforms to prevent inflated counts.
- Each commit item includes `source: "github"` to distinguish from GitLab commits in the dashboard.
