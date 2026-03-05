# Backfill Daily Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `/backfill-daily-updates` skill that fetches missing daily update data from Google Chat history and merges it into `raw_data.json`.

**Architecture:** A Claude Code skill file (`.claude/skills/backfill-daily-updates.md`) that instructs Claude to compute missing dates, search Google Chat threads, parse work hour messages, and merge results into `raw_data.json`. Reuses the same parsing logic as the existing `/fetch-daily-updates` skill.

**Tech Stack:** Claude Code skill (Markdown), Google Workspace MCP tools (`mcp__gws__chat_spaces_messages_list`), Vitest for validation.

---

### Task 1: Create the skill file with argument parsing and date computation

**Files:**
- Create: `.claude/skills/backfill-daily-updates.md`

**Step 1: Write the skill file**

Create `.claude/skills/backfill-daily-updates.md` with the following content:

```markdown
# Backfill Daily Updates from Google Chat

Backfill missing daily update data from Google Chat history into `raw_data.json`.

## Usage

- `/backfill-daily-updates` — auto-detect missing workdays (this week > last week > current month)
- `/backfill-daily-updates 3/3` — backfill a single date
- `/backfill-daily-updates 3/1-3/5` — backfill a date range

## Prerequisites

- `chat-config.json` exists with `spaceId`, `memberMap`, `queryKeyword`
- `raw_data.json` exists with current data

## Workflow

### Step 1: Load config and current data

Read `chat-config.json` to get `spaceId`, `memberMap`, `queryKeyword`.
Read `raw_data.json` to get existing `rawData` and `issues`.

### Step 2: Compute target dates

**If argument is provided:**
- Single date (e.g. `3/3`): target = `["3/3"]`
- Date range (e.g. `3/1-3/5`): expand to all dates from 3/1 to 3/5 inclusive
- Reject future dates. Show error for invalid format.

**If no argument:**
1. Compute this week's workdays (Monday through today)
2. Compute last week's workdays (Monday through Friday)
3. Compute remaining workdays in the current month (1st through today)
4. Combine in priority order: this week, last week, rest of month

**For all modes:**
- Exclude weekends (Saturday = `getDay() === 6`, Sunday = `getDay() === 0`)
- Exclude dates already present as keys in `rawData`
- If no dates remain, display "沒有需要補的日期" and stop

Use current year for all date computations. Format dates as `M/D` (no zero-padding) to match `rawData` keys.

### Step 3: Search Google Chat for Daily Update threads

Use `mcp__gws__chat_spaces_messages_list` to fetch messages:
```
params: { parent: "<spaceId>", pageSize: 100, orderBy: "createTime desc" }
```

For each page of results, scan messages client-side:
- For each target date still not found, check if the message text contains BOTH the `queryKeyword` (e.g. "Daily Update") AND the date string (e.g. "3/3")
- When a match is found, record its `thread.name` and associate it with that target date
- Also collect all other messages in the same batch that share the same `thread.name` — these are the replies

If not all target dates are found after one page, use `nextPageToken` to fetch the next page. Maximum 5 pages (500 messages). Stop early if all target dates are found.

### Step 4: For each found thread, get all replies

For each target date with a matched thread:
- Filter the fetched messages by `thread.name` to get all replies in that thread
- If the batch doesn't contain all replies (thread might span beyond fetched pages), make an additional `mcp__gws__chat_spaces_messages_list` call with `pageSize: 50` and filter by the thread name

### Step 5: Parse each reply into structured data

Reuse the same parsing logic as `/fetch-daily-updates` Step 4:

- **Sender**: Map `sender.name` (e.g. `users/12345`) to member name via `memberMap`. Skip unknown senders with a warning.
- **Hours**: Sum all hour values matching regex: `[（(]\s*(\d+(?:\.\d+)?)\s*[Hh](?:r|our|ours)?[^)）]*[)）]`
  - Items containing meeting/會議/讀書會/例會/討論/分享會/sync/臨時會 keywords -> `meeting` hours
  - Everything else -> `dev` hours
  - `total` = `meeting` + `dev`
- If no hours can be parsed, set `{ total: null, meeting: null, dev: null }`

Build a date entry: `{ "memberName": { total, meeting, dev }, ... }` for each target date.

### Step 6: Merge into rawData

For each target date with parsed data:
- Add the date entry to `rawData` (do NOT overwrite existing dates)
- Do NOT modify the `issues` array

### Step 7: Write, validate, and confirm

1. Write updated `raw_data.json`
2. Run `npm test` to verify schema validation passes
3. Show a summary table:

```
日期       | 狀態      | 補到人數 | 備註
-----------|----------|---------|--------
3/3（一）  | 成功      | 10/12   | 日銜、哲緯 未回報
3/5（三）  | 成功      | 12/12   |
3/6（四）  | 未找到    |  —      | Chat 中無對應 thread
```

4. Ask user to confirm, then:
```
git add raw_data.json
git commit -m "Backfill daily data for M/D, M/D"
git push
```

## Notes

- Google Chat API `messages.list` does NOT support text-based filtering. Must fetch and filter client-side.
- Messages are in Traditional Chinese. Hour patterns: `(1hr)`, `(1H)`, `(1 hour)`, `(1小時)`, `（1.5H）`.
- Both halfwidth `()` and fullwidth `（）` parentheses are used.
- Always preserve existing data — this is append-only for `rawData`.
- Do NOT touch the `issues` array. User can run `/fetch-daily-updates` afterward to regenerate issues.
- Multiple target dates share the same fetched message batch for efficiency.
```

**Step 2: Verify the skill is recognized**

Run: `ls .claude/skills/`
Expected: `backfill-daily-updates.md  fetch-daily-updates.md`

**Step 3: Commit**

```bash
git add .claude/skills/backfill-daily-updates.md
git commit -m "Add backfill-daily-updates skill"
```

---

### Task 2: Manual test — single date backfill

**Purpose:** Verify the skill works for a single specified date.

**Step 1: Identify a test date**

Check `raw_data.json` for existing dates. Pick a date that does NOT exist yet (e.g. `3/3` if it's missing).

**Step 2: Run the skill**

Invoke `/backfill-daily-updates 3/3`

**Step 3: Verify results**

- Confirm the skill found the correct thread in Google Chat
- Confirm `raw_data.json` now has the new date key
- Confirm `issues` array was NOT modified
- Run `npm test` — all tests should pass
- Verify the summary table is displayed correctly

**Step 4: Commit if successful**

```bash
git add raw_data.json
git commit -m "Backfill daily data for 3/3"
```

---

### Task 3: Manual test — date range backfill

**Purpose:** Verify range parsing and multi-date backfill.

**Step 1: Run the skill with a range**

Invoke `/backfill-daily-updates 3/3-3/5` (adjust to dates that are missing)

**Step 2: Verify results**

- Confirm multiple dates were added to `rawData`
- Confirm weekends within the range were skipped
- Confirm already-existing dates were not overwritten
- Run `npm test` — all tests should pass
- Verify the summary table shows status for each date

**Step 3: Commit if successful**

```bash
git add raw_data.json
git commit -m "Backfill daily data for 3/3-3/5"
```

---

### Task 4: Manual test — auto-detect mode (no argument)

**Purpose:** Verify priority-based date detection.

**Step 1: Run the skill without arguments**

Invoke `/backfill-daily-updates`

**Step 2: Verify results**

- Confirm it identified the correct missing workdays
- Confirm priority order: this week first, then last week, then rest of month
- Confirm weekends and existing dates were excluded
- If no dates are missing, confirm it shows "沒有需要補的日期"

**Step 3: Commit if successful**

```bash
git add raw_data.json
git commit -m "Backfill missing daily data"
git push
```
