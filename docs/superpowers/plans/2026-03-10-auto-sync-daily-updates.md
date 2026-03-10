# Auto Sync Daily Updates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate daily update sync from Google Chat → Google Drive JSON (for dashboard) + Google Sheets (for team viewing), replacing manual raw_data.json git commits.

**Architecture:** A unified `/sync-daily-updates` skill fetches Chat messages, parses hours with the existing `parse-daily-updates.js`, merges with existing data downloaded from Google Drive, then uploads the updated JSON back to Drive. The dashboard (GitHub Pages) fetches from the Drive public URL instead of a local `raw_data.json`. A merge helper script handles the data combination logic.

**Tech Stack:** Node.js scripts, Google Workspace MCP tools (Chat, Drive, Sheets export), Claude Code skills

**Key IDs:**
- Spreadsheet: `1-HSbdexmualS3zc9Ut_BjMwKdR7TEPRZ8QuSVHhp_QA`
- Chat Space: `spaces/AAQAQhmoRAk`
- Drive JSON file ID: TBD (created in Task 1)

---

## Chunk 1: Infrastructure & Merge Script

### Task 1: Upload raw_data.json to Google Drive and set sharing

One-time setup: create the Drive-hosted JSON file that the dashboard will read from.

**Files:**
- Read: `raw_data.json`
- Create: `drive-config.json`

- [ ] **Step 1: Upload raw_data.json to Google Drive**

Use `mcp__gws__drive_files_create` to upload:

```
params: {}
body: { "name": "raw_data.json", "mimeType": "application/json" }
upload: "raw_data.json"  (local file path)
```

Record the returned file `id`.

- [ ] **Step 2: Set sharing to "anyone with link can view"**

Use `mcp__gws__drive_permissions_create`:

```
params: { "fileId": "<FILE_ID_FROM_STEP_1>" }
body: { "role": "reader", "type": "anyone" }
```

- [ ] **Step 3: Verify the public download URL works**

The public URL format is:
```
https://drive.google.com/uc?export=download&id=<FILE_ID>
```

Use `WebFetch` to verify the URL returns valid JSON.

- [ ] **Step 4: Create drive-config.json**

Write `drive-config.json` with the file ID:

```json
{
  "fileId": "<FILE_ID_FROM_STEP_1>",
  "downloadUrl": "https://drive.google.com/uc?export=download&id=<FILE_ID>"
}
```

- [ ] **Step 5: Add drive-config.json to .gitignore**

Append `drive-config.json` to `.gitignore` (it contains deployment-specific config).

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "Add drive-config.json to gitignore for Drive file ID storage"
```

---

### Task 2: Create merge helper script

A Node.js script that takes existing `raw_data.json` data + parsed output from `parse-daily-updates.js` and produces a merged result.

**Files:**
- Create: `scripts/merge-daily-data.js`
- Create: `tests/merge-daily-data.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/merge-daily-data.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { mergeDailyData } from '../scripts/merge-daily-data.js';

describe('mergeDailyData', () => {
  const existing = {
    rawData: {
      '3/5': {
        Joyce: { total: 10, meeting: 0, dev: 10 },
        Ivy: { total: 4, meeting: 0, dev: 4 },
      },
    },
    issues: [{ member: 'Joyce', severity: '🟡', text: '超時 10hr' }],
    leave: { Jason: [{ start: '3/5', end: '3/11' }] },
  };

  const parsed = {
    dateEntries: {
      '3/6': {
        threadDate: '3/7',
        contentDate: '3/6',
        entry: {
          Joyce: { total: 8, meeting: 2, dev: 6 },
          Ivy: { total: 7, meeting: 0, dev: 7 },
        },
        alreadyExists: false,
        reportedCount: 2,
        totalMembers: 2,
      },
    },
    leaveMap: {
      Jason: [{ start: '3/5', end: '3/11' }],
      Aaron: [{ start: '3/13', end: '3/13' }],
    },
    issues: [
      { member: 'Joyce', severity: '🟢', text: '穩定 8hr' },
      { member: 'Ivy', severity: '🟢', text: '穩定 7hr' },
    ],
    warnings: [],
  };

  it('should merge new date entries into rawData', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.rawData['3/5']).toEqual(existing.rawData['3/5']);
    expect(result.rawData['3/6']).toEqual(parsed.dateEntries['3/6'].entry);
  });

  it('should skip dates that already exist', () => {
    const parsedWithExisting = {
      ...parsed,
      dateEntries: {
        ...parsed.dateEntries,
        '3/5': {
          ...parsed.dateEntries['3/6'],
          alreadyExists: true,
          entry: { Joyce: { total: 99, meeting: 0, dev: 99 } },
        },
      },
    };
    const result = mergeDailyData(existing, parsedWithExisting);
    expect(result.rawData['3/5'].Joyce.total).toBe(10); // unchanged
  });

  it('should replace issues with parsed issues', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.issues).toEqual(parsed.issues);
  });

  it('should replace leave with parsed leaveMap', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.leave).toEqual(parsed.leaveMap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/merge-daily-data.test.js`
Expected: FAIL with "mergeDailyData is not a function" or similar import error.

- [ ] **Step 3: Write the merge script**

Create `scripts/merge-daily-data.js`:

```javascript
#!/usr/bin/env node
'use strict';

/**
 * Merges parsed daily update output with existing raw_data.json data.
 *
 * Usage (CLI): node scripts/merge-daily-data.js <existing.json> <parsed.json>
 * Outputs merged JSON to stdout.
 *
 * Usage (module): import { mergeDailyData } from './merge-daily-data.js'
 */

function mergeDailyData(existing, parsed) {
  const rawData = { ...existing.rawData };

  // Add new date entries (skip already existing)
  for (const [date, info] of Object.entries(parsed.dateEntries || {})) {
    if (!info.alreadyExists && !rawData[date]) {
      rawData[date] = info.entry;
    }
  }

  return {
    rawData,
    issues: parsed.issues || existing.issues || [],
    leave: parsed.leaveMap || existing.leave || {},
  };
}

// CLI mode
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node scripts/merge-daily-data.js <existing.json> <parsed.json>');
    process.exit(1);
  }

  const existing = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const parsed = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const result = mergeDailyData(existing, parsed);
  console.log(JSON.stringify(result, null, 2));
}

// ESM-compatible export for vitest
if (typeof module !== 'undefined') {
  module.exports = { mergeDailyData };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/merge-daily-data.test.js`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/merge-daily-data.js tests/merge-daily-data.test.js
git commit -m "Add merge-daily-data script for combining parsed data with existing"
```

---

## Chunk 2: Dashboard Update & Skill

### Task 3: Update dashboard to fetch from Google Drive

Change `index.html` to read data from the Drive public URL instead of local `raw_data.json`.

**Files:**
- Modify: `index.html:150-160` (the `useEffect` fetch block)
- Read: `drive-config.json` (for the download URL)

- [ ] **Step 1: Read drive-config.json to get the download URL**

After Task 1 completes, `drive-config.json` will contain the `downloadUrl`.

- [ ] **Step 2: Update the fetch URL in index.html**

In `index.html`, find the `useEffect` block (around line 150-160):

```javascript
// OLD:
fetch("raw_data.json")

// NEW:
fetch("https://drive.google.com/uc?export=download&id=<FILE_ID>")
```

Replace `<FILE_ID>` with the actual file ID from `drive-config.json`.

- [ ] **Step 3: Test locally**

Run: `python3 -m http.server 8000`

Open `http://localhost:8000` in a browser. The dashboard should load data from Google Drive. Verify:
- Charts render correctly
- Issue ticker shows
- All three views (Daily, Trend, Weekly) work

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Update dashboard to fetch data from Google Drive instead of local JSON"
```

---

### Task 4: Create the /sync-daily-updates skill

The unified skill that Claude executes to sync data from Chat to Drive + Sheets.

**Files:**
- Create: `.claude/skills/sync-daily-updates.md`
- Remove reference: `.claude/skills/fetch-daily-updates.md` (keep for reference but sync replaces it)
- Remove reference: `.claude/skills/backfill-daily-updates.md` (keep for reference but sync replaces it)

- [ ] **Step 1: Create the skill file**

Create `.claude/skills/sync-daily-updates.md`:

```markdown
# Sync Daily Updates

Fully automated: fetch daily updates from Google Chat, parse, merge, and upload to Google Drive + Google Sheets.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap`
- `drive-config.json` exists with `fileId` and `downloadUrl`

## Workflow

### Step 1: Download existing data from Google Drive

1. Read `drive-config.json` → get `fileId`
2. Use `mcp__gws__drive_files_get` with `params: { "fileId": "<fileId>", "alt": "media" }` to download the current `raw_data.json`
3. If the result is saved to a file, note the path. Otherwise save the JSON to `/tmp/existing-data.json`

### Step 2: Check existing leave

1. Parse the downloaded data
2. Display current leave entries:
   ```
   目前已知休假：
   - Jason: 3/5-3/11
   ```
   If no leave, display "目前無已知休假記錄".

### Step 3: Fetch messages from Google Chat

1. Read `chat-config.json` → get `spaceId`
2. Use `mcp__gws__chat_spaces_messages_list`:
   ```
   params: { "parent": "<spaceId>", "pageSize": 100, "orderBy": "createTime desc" }
   ```
3. Save the result to `/tmp/chat-messages.json`

### Step 4: Parse messages

```bash
node scripts/parse-daily-updates.js /tmp/chat-messages.json
```

Save output to `/tmp/parsed-output.json`.

### Step 5: Merge data

```bash
node scripts/merge-daily-data.js /tmp/existing-data.json /tmp/parsed-output.json > /tmp/merged-data.json
```

### Step 6: Upload merged data to Google Drive

Use `mcp__gws__drive_files_update`:
```
params: { "fileId": "<fileId>" }
body: { "mimeType": "application/json" }
upload: "/tmp/merged-data.json"
```

### Step 7: Update Google Sheets (structured view)

Export the merged data as CSV and upload to the Spreadsheet.

1. Read `/tmp/merged-data.json`
2. For each date/member entry, format as CSV rows:
   ```
   date,member,total,meeting,dev
   3/5,Joyce,10,0,10
   3/5,Ivy,4,0,4
   ```
3. Save to `/tmp/rawData-sheet.csv`
4. Use `mcp__gws__drive_files_update` to update the Spreadsheet with the rawData sheet:
   ```
   params: { "fileId": "1-HSbdexmualS3zc9Ut_BjMwKdR7TEPRZ8QuSVHhp_QA" }
   body: { "mimeType": "application/vnd.google-apps.spreadsheet" }
   upload: "/tmp/rawData-sheet.csv"
   ```
   Note: This replaces the first sheet. If the team wants to keep the original raw content sheet, create a separate spreadsheet for structured data instead.

### Step 8: Output summary

Display a summary:
```
✅ Sync 完成
新增日期：3/9
回報人數：11/12
Warnings：無
Drive JSON 已更新：<downloadUrl>
```

## Notes

- The skill is idempotent: running it multiple times won't duplicate data (alreadyExists check in merge script).
- Thread date ≠ content date. "3/6 Daily Update" thread has 3/5 progress.
- All parsing rules are in `scripts/parse-daily-updates.js`.
- Leave detection is automatic from Chat messages containing 請假/休假.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sync-daily-updates.md
git commit -m "Add unified /sync-daily-updates skill replacing fetch + backfill"
```

---

## Chunk 3: Tests, CLAUDE.md, & Migration

### Task 5: Update tests and CLAUDE.md

**Files:**
- Modify: `tests/data-schema.test.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run existing tests to verify baseline**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 2: Update CLAUDE.md**

Update `CLAUDE.md` to reflect the new architecture. Key changes:

1. In the **Architecture** section, add:
   - `drive-config.json` (gitignored): Google Drive file config with `fileId` and `downloadUrl`
   - `scripts/merge-daily-data.js`: Merges parsed output with existing data

2. In the **Development** section, update:
   - "To update data": now references `/sync-daily-updates` as the primary method
   - Add note that `raw_data.json` in repo is now a backup; live data is on Google Drive

3. In the **Google Chat Integration** section, update:
   - Reference the new `/sync-daily-updates` skill as the unified approach
   - Note that `/fetch-daily-updates` and `/backfill-daily-updates` are superseded

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md for Drive-based data architecture and sync skill"
```

---

### Task 6: End-to-end migration verification

Run the full sync flow to verify everything works together.

**Prerequisites:** Tasks 1-5 all complete.

- [ ] **Step 1: Run /sync-daily-updates**

Execute the skill manually to verify the full pipeline works.

- [ ] **Step 2: Verify Drive JSON is updated**

Use `WebFetch` on the public Drive URL. Verify the JSON is valid and contains expected data.

- [ ] **Step 3: Verify dashboard loads from Drive**

Run: `python3 -m http.server 8000`
Open the dashboard and verify all data renders correctly.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Final commit and summary**

If any fixes were needed during verification, commit them. Then provide a summary of all changes made.
