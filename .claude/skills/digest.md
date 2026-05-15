---
description: Generate the CXO weekly digest — runs scripts/generate-weekly-digest.js to aggregate the last full Mon-Fri week, calls Claude for a decision-grade summary, shows the markdown preview, and optionally posts to Google Chat (requires explicit confirmation). Use when asked '產生週報', '/digest', 'weekly digest', or 'CXO 週報'.
user_invocable: true
---

# Weekly Digest (CXO 週報)

Produce a CXO-grade weekly digest from `public/raw_data.json`, `public/gitlab-commits.json`, `public/task-analysis.json`, and `public/plan-analysis.json`. Optionally posts to Google Chat after explicit user confirmation.

## Prerequisites

- `public/raw_data.json` exists (required)
- `public/gitlab-commits.json`, `public/task-analysis.json`, `public/plan-analysis.json` — used if present; gracefully skipped otherwise
- `claude` CLI on PATH (for the AI summary; falls back to raw-metrics digest if absent)
- `chat-config.json` with `spaceId` — only required for Step 4 (Chat send)

## Workflow

### Step 1: Generate digest

Determine the target week:
- Default = last full Mon-Fri (e.g. on Wed 5/14 → 5/4-5/8)
- Override via `--week M/D-M/D` if the user specified one (e.g. `/digest 5/12-5/16`)

Run the generator. It internally:
1. Loads the four JSON files
2. Aggregates per-center metrics (work hours, reporting rate, commits, consistency, top warnings, consecutive-missing, spec activity)
3. Pipes a structured prompt to `claude --print --model sonnet`
4. Formats the resulting JSON into Google Chat markdown

```bash
node scripts/generate-weekly-digest.js [--week <M/D-M/D>] > /tmp/digest-output.txt 2>/tmp/digest-stderr.txt
```

If the user passed a `--space <spaceId>` override, remember it for Step 4.

### Step 2: Preview

Print `/tmp/digest-output.txt` to the user verbatim, prefixed with:

```
📄 預覽（尚未發送）
─────────────────
```

If `/tmp/digest-stderr.txt` contains warnings (e.g. `claude CLI call failed`, `claude output was not valid JSON`), show them as a note above the preview:

```
⚠️ 注意：AI 摘要未產生（claude CLI 失敗 / 非 JSON 輸出），以下為以原始指標組合的 fallback 摘要。
```

### Step 3: Ask for confirmation

Ask exactly:

```
要發送到 Google Chat 嗎？(y/N)
```

Wait for an explicit reply. Per project policy (memory: `feedback_chat_notification.md`), Chat notifications require explicit user confirmation before sending. **Never auto-send.** Only treat `y`, `yes`, `送`, `發送`, `好`, `Y` as confirmation; anything else (including empty / no reply) is decline.

### Step 4: Send (only if confirmed)

If declined → output `已取消，未發送。` and stop.

If confirmed:

1. Resolve `spaceId`:
   - If user passed `--space <spaceId>`, use that
   - Else read `chat-config.json` from project root
   - If neither is available, output `❌ 找不到 spaceId（請傳入 --space 或建立 chat-config.json）。` and stop
2. Send via `mcp__gws__chat_spaces_messages_create`:
   ```
   parent: <spaceId>
   message: { text: <contents of /tmp/digest-output.txt> }
   ```
3. Output:
   ```
   ✅ 已發送到 Google Chat (spaceId: <spaceId>)
   ```

### Step 5 (optional): Skip

If the user clearly says "just preview" or passes `--preview`, skip Step 3 entirely and end after Step 2.

## Fallback behavior

If `claude` CLI is unavailable or its output is not valid JSON, the script still emits a markdown digest built from raw aggregation data (with a single "AI 摘要未產生" recommendation). Step 2 will still show this — surface the `⚠️` note from Step 2 so the user knows the AI summary was skipped.

## Examples

- `/digest` → default last full Mon-Fri week
- `/digest 5/12-5/16` → specific week
- `產生週報` → same as `/digest`

## Gotchas

- The script makes a real `claude` API call by default. If you want to test the formatting only, run `node scripts/generate-weekly-digest.js --no-ai`.
- `period` in plan-analysis.json may be a single date (`M/D`) rather than a range — the script reads `summary` only, so this doesn't matter.
- Members on leave are excluded from the reporting-rate denominator AND from consecutive-missing detection.
- `mcp__gws__chat_spaces_messages_create` requires a logged-in Google Workspace MCP session. If the call fails, do **not** retry blindly — surface the error to the user.
