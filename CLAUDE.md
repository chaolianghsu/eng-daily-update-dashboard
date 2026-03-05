# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engineering Department Daily Update Dashboard — a React dashboard for tracking team work hours, analyzing consistency, and surfacing risk warnings. UI is in Traditional Chinese.

## Architecture

- **`index.html`** (~475 lines): React 18 + Recharts loaded via unpkg CDN with Babel Standalone for in-browser JSX transpilation. `Dashboard` component fetches `raw_data.json` at runtime with loading/error states.
- **`raw_data.json`**: Dashboard data — `rawData` (work hours by date/member) and `issues` (risk warnings). Members list and colors are auto-computed from rawData keys.
- **`chat-config.json`** (gitignored): Google Chat space config with `spaceId` and `memberMap` for user ID to name mapping.
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
  ]
}
```

## Development

**To run locally**: Serve with `python3 -m http.server` (fetch requires HTTP, not file://). Open `http://localhost:8000`.

**To run tests**: `npm test` (Vitest). Tests validate `raw_data.json` schema and `SEVERITY_COLORS` mapping.

**To update data manually**: Edit `raw_data.json` directly. Charts and tables render reactively from this data.

**To update data from Google Chat**: Run `/fetch-daily-updates` skill — pulls daily updates from the Chat space, parses hours, generates issues, and updates `raw_data.json`.

## Deployment

GitHub Pages via `.github/workflows/pages.yml`. Deploys on pushes to `main`.

## Google Chat Integration

The team posts daily work hour reports in Google Chat space `spaces/AAQAQhmoRAk`. The `/fetch-daily-updates` skill automates data extraction:

1. Reads `chat-config.json` for space ID and member mapping
2. Fetches messages via `mcp__gws__chat_spaces_messages_list`
3. Finds "Daily Update" thread and parses replies
4. Extracts hours from patterns like `(Xhr)`, `(XH)`, `（1.5H）`, `(X小時)`
5. Generates issues based on rules (missing reports, overtime, low hours, etc.)
6. Merges into `raw_data.json` and runs tests

## Key Conventions

- All CDN dependencies are pinned (React 18.2.0, Recharts 2.12.7, Babel 7.24.7)
- Color palette: background `#0f172a`, cards `#1e293b`, accents blue/green/yellow/red/orange
- Font stack: JetBrains Mono, SF Mono, Noto Sans TC
- Issue severity: 🔴 critical, 🟡 warning, 🟠 caution, 🟢 improvement
- `SEVERITY_COLORS` object maps severity emoji to `{ sc, bg }` color pair
