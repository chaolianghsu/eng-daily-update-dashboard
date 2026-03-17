# Sync GitLab Commits

Fetch GitLab commits for the engineering team and update Google Spreadsheet.

## Prerequisites

- `gitlab-config.json` exists with `baseUrl`, `token`, `memberMap`, `excludeAuthors`
- `public/raw_data.json` exists with current data
- Git remote is configured for push

## Workflow

### Step 1: Read config

Read `gitlab-config.json` to confirm settings exist. Verify it has `baseUrl`, `token`, `memberMap`, and `excludeAuthors` fields.

### Step 2: Determine date

If no date argument provided, use previous work day.
User can specify: `/sync-gitlab-commits 3/11` or `/sync-gitlab-commits 3/9-3/12`

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

## Notes

- The script writes `public/gitlab-commits.json` (for dashboard) and outputs the POST payload to stdout.
- Progress and warnings go to stderr.
- Unmapped authors appear in stderr warnings — consider adding them to `gitlab-config.json` memberMap.
- Idempotent: Google Sheets deduplicates by date|member|sha.
