# Auto Sync Daily Updates Design

## Overview

Automate daily update data collection from Google Chat, writing structured data to Google Sheets (private, team viewing) and a JSON file on Google Drive (public link, dashboard consumption). Replaces manual `raw_data.json` git commits.

## Architecture

```
Google Chat → [/sync-daily-updates skill] → parse hours → Google Sheets (private)
                                                         → Google Drive JSON (public link)
                                                                   ↓
                                                         Dashboard (GitHub Pages) fetches Drive JSON
```

## Data Stores

### Google Sheets (private)

Spreadsheet: `1-HSbdexmualS3zc9Ut_BjMwKdR7TEPRZ8QuSVHhp_QA`

Three new sheets added:

**`rawData` sheet:**
| date | member | total | meeting | dev |
|------|--------|-------|---------|-----|
| 3/5  | Jason  | 7     | 1       | 6   |

**`issues` sheet:**
| member | severity | text |
|--------|----------|------|
| Jason  | 🟡       | 超時 9hr |

**`leave` sheet:**
| member | start | end |
|--------|-------|-----|
| Jason  | 3/5   | 3/11 |

Existing sheet with raw content is preserved unchanged.

### Google Drive

- A `raw_data.json` file uploaded to Drive
- Sharing: "Anyone with the link can view"
- Dashboard fetches from the Drive public download URL

## Unified Skill: `/sync-daily-updates`

Fully autonomous flow:

1. Read `chat-config.json` for spaceId and memberMap
2. Read existing data from Sheets (rawData/issues/leave sheets) — replaces reading `raw_data.json`
3. Fetch messages from Google Chat via `mcp__gws__chat_spaces_messages_list`
4. Save messages to temp file, run `node scripts/parse-daily-updates.js`
5. Merge new date entries with existing data (append-only for rawData)
6. Write updated data to Sheets (rawData / issues / leave)
7. Compose full `raw_data.json` and upload to Google Drive (overwrite)
8. Output summary: dates added, members reported, warnings

## Dashboard Changes

- `index.html`: Change `fetch('raw_data.json')` to `fetch(DRIVE_PUBLIC_URL)`
- The Drive public URL format: `https://drive.google.com/uc?export=download&id={FILE_ID}`
- No other changes needed — the JSON schema remains identical

## Scheduling

Handled externally via Claude Cowork schedule configuration. The skill is designed to be called repeatedly and is idempotent (skips dates already present in Sheets).

## Manual Trigger

Run `/sync-daily-updates` directly in Claude Code for on-demand sync.

## Migration

1. Create the 3 new sheets in the existing Spreadsheet
2. Migrate existing `raw_data.json` data into the sheets (one-time)
3. Upload initial `raw_data.json` to Google Drive, set sharing
4. Update `index.html` fetch URL
5. Verify dashboard works with Drive-hosted JSON
6. Old `raw_data.json` in repo becomes unused (can keep for backup)
