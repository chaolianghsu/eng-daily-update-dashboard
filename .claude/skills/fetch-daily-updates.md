# Fetch Daily Updates from Google Chat

Fetch daily work hour reports from the Google Chat space and update `raw_data.json`.

## Prerequisites

- `chat-config.json` exists with `spaceId` and `memberMap`
- `raw_data.json` exists with current data

## Workflow

### Step 1: Load config and current data

```
Read chat-config.json → get spaceId, memberMap, queryKeyword
Read raw_data.json → get existing rawData, issues
```

### Step 2: Find the Daily Update thread for today

Use `mcp__gws__chat_spaces_messages_list` to get recent messages:

```
params: { parent: "<spaceId>", pageSize: 100, orderBy: "createTime desc" }
```

Search results for messages containing the `queryKeyword` (e.g., "Daily Update"). This message is the thread starter — note its `thread.name`.

### Step 2.5: Scan for leave announcements

From the messages fetched in Step 2, filter those where `text` contains `請假` or `休假`. These are standalone leave announcement threads.

**Identify member**: Use `sender.name` (user ID) → `memberMap` lookup. Do NOT parse name from message text (nicknames differ from rawData names, e.g. 火鍋=家輝, Chris=禎佑, Yuriy=侑呈).

**Parse date range** from message text:

| Format | Example | Result |
|--------|---------|--------|
| Two M/D patterns | `5/21(四)~5/26(二)` | 5/21 → 5/26 |
| Full-width separator | `3/16～ 3/20` | 3/16 → 3/20 |
| Same-month shorthand | `3/19~20` | 3/19 → 3/20 |
| Single day | `3/13 (五)` | 3/13 → 3/13 |
| Partial day (ignore partial, use full range) | `3/13(五)下午 ~ 3/18(三)` | 3/13 → 3/18 |

Regex strategy:
1. Find all `M/D` patterns: `/(\d{1,2})\/(\d{1,2})/g`
2. If 2+ matches → `start = first, end = last`
3. If 1 match → check for `~N` shorthand: `/(\d{1,2})\/(\d{1,2})\s*(?:\([^)]*\))?\s*[~～]\s*(\d{1,2})/`
   - If matched: same month, `end = M/matched_day`
   - If no range indicator: single day (`start = end`)

**Build leave map**: `{ memberName: [{ start: "M/D", end: "M/D" }, ...] }`

A member may have multiple leave entries. Store all ranges.

### Step 3: Get all replies in the thread

Filter messages by the thread name found in Step 2. Each reply is a team member's daily update.

### Step 4: Parse each message into structured data

Each message follows this format:
```
M/D 進度：
1. [Done] Task description (Xhr)
2. [In Progress] Task description (Xhr)
...
Block:
...
```

Extract from each message:
- **Sender**: Map `sender.name` (e.g., `users/12345`) → member name via `memberMap`
- **Date**: Extract from message text (M/D format)
- **Hours**: Sum all hour values in parentheses `(Xhr)`, `(XH)`, `（XH）`, `(X小時)` → `total`
  - Regex: `[（(]\s*(\d+(?:\.\d+)?)\s*(?:[Hh](?:r|our|ours)?|小時)[^)）]*[)）]`
  - Bare `(7)` is NOT matched — too ambiguous (could be task count)
  - Items containing meeting/會議/讀書會/例會/討論/分享會/sync/臨時會 keywords → `meeting` hours
  - Everything else → `dev` hours
- If no hours can be parsed, set `{ total: null, meeting: null, dev: null }`

### Step 5: Generate issues automatically

Apply these rules to generate the `issues` array:

| Priority | Condition | Severity | Text template |
|----------|-----------|----------|---------------|
| 1 | Member has null data AND date is within a leave range | 🟠 | "休假 {start}-{end}" or "休假 {date}" (single day) |
| 2 | Member has null data for 2+ consecutive days (excluding leave days) | 🔴 | "連續 N 天未回報" |
| 3 | Member not reported today (NOT on leave today) | 🔴 | "未回報 M/D" |
| 4 | Member total > 10hr | 🟡 | "超時 {total}hr" |
| 5 | Member total < 5hr (non-null) | 🟡 | "工時偏低 {total}hr" |
| 6 | Meeting % > 50% | 🟡 | "會議佔比 {pct}%" |
| 7 | Member improved from < 6hr to >= 6.5hr | 🟢 | "改善 {prev}→{curr}hr" |
| 8 | Member stable at >= 7hr | 🟢 | "穩定 {total}hr" |

**Leave-aware logic:**
- Use the leave map from Step 2.5
- **Date-in-range check**: Parse M/D strings to compare numerically: `start <= date <= end` (same year assumed)
- Leave days do NOT count toward "連續 N 天未回報" streak
- If a member is on leave for today's date, emit 🟠 instead of 🔴

### Step 6: Merge with existing data

- Add new date entries to `rawData` (don't overwrite existing dates)
- Replace `issues` with newly generated ones
- Members list is auto-computed from rawData keys in index.html — no need to maintain

### Step 7: Write and confirm

1. Write updated `raw_data.json`
2. Run `npm test` to verify schema validation passes
3. Show a summary table of the update to the user
4. Ask user to confirm, then:
   ```
   git add raw_data.json
   git commit -m "Update daily data for M/D"
   git push
   ```

## Notes

- The Google Chat API `messages.list` does NOT support text-based filtering. You must fetch recent messages and filter client-side.
- Messages are in Traditional Chinese. Hour patterns: `(1hr)`, `(1H)`, `(1 hour)`, `(1小時)`, `（1.5H）`.
- Both halfwidth `()` and fullwidth `（）` parentheses are used.
- If a member is not in `memberMap`, log a warning and skip.
- Always preserve existing data — this is append-only for `rawData`.
- Leave announcements are standalone threads in the same space (not inside Daily Update threads). They are already included in the Step 2 fetch results.
- A member may have multiple leave entries (e.g., separate sick leave and vacation). Check all ranges.
- If a sender of a leave message is not in `memberMap`, skip it silently.
