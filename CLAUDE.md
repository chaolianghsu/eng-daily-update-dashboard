# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engineering Department Daily Update Dashboard — a React dashboard for tracking team work hours, analyzing consistency, and surfacing risk warnings. UI is in Traditional Chinese.

## Architecture

- **`index.html`** (~475 lines): React 18 + Recharts loaded via unpkg CDN with Babel Standalone for in-browser JSX transpilation. `Dashboard` component fetches `raw_data.json` at runtime with loading/error states.
- **`raw_data.json`**: Dashboard data — `rawData` (work hours by date/member) and `issues` (risk warnings). Members list and colors are auto-computed from rawData keys.
- **`chat-config.json`** (gitignored): Google Chat space config with `spaceId` and `memberMap` for user ID to name mapping.
- **`scripts/parse-daily-updates.js`**: Shared parsing logic for daily update data — hour extraction, leave detection, issue generation. Used by both `/fetch-daily-updates` and `/backfill-daily-updates` skills. Run via `node scripts/parse-daily-updates.js <messages-file> [--leave "Name:M/D-M/D"]`.
- **`scripts/merge-daily-data.js`**: Merges parsed daily update output with existing raw_data.json data. Used by `/sync-daily-updates` skill.
- Three dashboard views: Daily, Trend, Weekly
- Dark theme with inline styles; no external CSS

### raw_data.json Schema

```json
{
  "rawData": {
    "M/D": {
      "member": { "total": "number|null", "meeting": "number|null", "dev": "number|null" }
    }
  },
  "issues": [
    { "member": "string", "severity": "🔴|🟡|🟠|🟢", "text": "string" }
  ],
  "leave": {
    "member": [{ "start": "M/D", "end": "M/D" }]
  }
}
```

## Development

**To run locally**: Serve with `python3 -m http.server` (fetch requires HTTP, not file://). Open `http://localhost:8000`.

**To run tests**: `npm test` (Vitest). Tests validate `raw_data.json` schema and `SEVERITY_COLORS` mapping.

**To update data manually**: Edit `raw_data.json` directly. Charts and tables render reactively from this data.

**To update data from Google Chat**: Run `/sync-daily-updates` skill — fully automated: fetches Chat messages, parses hours, merges data, commits, pushes, and optionally updates Google Sheets.

## Deployment

GitHub Pages via `.github/workflows/pages.yml`. Deploys on pushes to `main`.

## Google Chat Integration

The team posts daily work hour reports in Google Chat space `spaces/AAQAQhmoRAk`. The `/sync-daily-updates` skill automates data extraction:

1. Reads `chat-config.json` for space ID and member mapping
2. Fetches messages via `mcp__gws__chat_spaces_messages_list`
3. Saves output to file, runs `node scripts/parse-daily-updates.js` to parse
4. Script extracts hours, detects leave, generates issues
5. Thread date ≠ content date ("3/6 Daily Update" contains 3/5 progress)
6. Reviews output, merges into `raw_data.json`, and runs tests

The older `/fetch-daily-updates` and `/backfill-daily-updates` skills are superseded by `/sync-daily-updates`.

## Key Conventions

- All CDN dependencies are pinned (React 18.2.0, Recharts 2.12.7, Babel 7.24.7)
- Color palette: background `#0f172a`, cards `#1e293b`, accents blue/green/yellow/red/orange
- Font stack: JetBrains Mono, SF Mono, Noto Sans TC
- Issue severity: 🔴 critical, 🟡 warning, 🟠 caution, 🟢 improvement
- `SEVERITY_COLORS` object maps severity emoji to `{ sc, bg }` color pair
