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
params: { parent: "<spaceId>", pageSize: 30, orderBy: "createTime desc" }
```

Search results for messages containing the `queryKeyword` (e.g., "Daily Update"). This message is the thread starter — note its `thread.name`.

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
- **Hours**: Sum all hour values in parentheses `(Xhr)`, `(XH)`, `（XH）`, `(X小時)`, `(X)` → `total`
  - Regex: `[（(]\s*(\d+(?:\.\d+)?)\s*(?:[Hh](?:r|our|ours)?|小時)?[^)）]*[)）]`
  - Items containing meeting/會議/讀書會/例會/討論/分享會/sync/臨時會 keywords → `meeting` hours
  - Everything else → `dev` hours
- If no hours can be parsed, set `{ total: null, meeting: null, dev: null }`

### Step 5: Generate issues automatically

Apply these rules to generate the `issues` array:

| Condition | Severity | Text template |
|-----------|----------|---------------|
| Member has null data for 2+ consecutive days | 🔴 | "連續 N 天未回報" |
| Member not reported today | 🔴 | "未回報 M/D" |
| Member total > 10hr | 🟡 | "超時 {total}hr" |
| Member total < 5hr (non-null) | 🟡 | "工時偏低 {total}hr" |
| Meeting % > 50% | 🟡 | "會議佔比 {pct}%" |
| Member improved from < 6hr to >= 6.5hr | 🟢 | "改善 {prev}→{curr}hr" |
| Member stable at >= 7hr | 🟢 | "穩定 {total}hr" |

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
