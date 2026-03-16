# Task Reasonableness Analysis Design

## Problem

Current consistency analysis only checks "has hours" vs "has commits" (binary). It cannot detect:
- High dev hours reported with minimal commit output
- Task descriptions that don't match commit content
- Individual members whose hours-to-commits ratio deviates significantly from team average

## Solution

A Claude Code CLI-driven analysis system that compares daily update task details against GitLab commits and flags unreasonable entries.

## Architecture

### Data Flow

```
raw_data.json (dailyUpdates[].text) ──┐
                                       ├──→ scripts/prepare-task-analysis.js ──→ prompt.txt
gitlab-commits.json (commits)  ────────┘
                                                                                    │
                                                                    claude -p < prompt.txt
                                                                                    │
                                                                                    ▼
                                                                         task-analysis.json
                                                                                    │
                                                                                    ▼
                                                                    Dashboard (CommitsView)
```

### Component 1: Data Preparation Script

**File:** `scripts/prepare-task-analysis.js`

Reads `raw_data.json` and `gitlab-commits.json`, produces a structured prompt for Claude Code.

**Input:** `--date <M/D>` (single date) or `--range <M/D-M/D>` (date range)

**Output to stdout:** A prompt containing per-member data:
```
## Member: Wendy (3/13)

### Reported Tasks (from daily update):
1. [In Progress] SY ESv9 升級/維護 - 調整連線至 IDC 機房 ES (3H)
2. [Done] 兩個情緒編修排程釐清 (1H)
3. [Done] 大數據官網後台 MR 審核 (2H)
Total reported: 7.5H (meeting: 1.5H, dev: 6H)

### GitLab Commits (same day):
- [CrawlersV2/fanti-insights-api] fix: adjust ES connection config (c6108...)
- [dailyview/admin-panel] review: merge MR #42 (a3f21...)
Total: 2 commits across 2 projects

### Team Average (3/13):
Avg dev hours: 6.2H, Avg commits: 8.3
```

**Logic:**
- Parses task items from `dailyUpdates[].text` using regex (numbered list items with hour annotations)
- Matches member's commits from `gitlab-commits.json` for the same date
- Computes team averages for context

### Component 2: Claude Code Analysis

**Execution:** `node scripts/prepare-task-analysis.js --date 3/13 | claude -p "$(cat)"`

The prompt instructs Claude to:
1. **Low output check (A):** For each dev task with hours, assess if commit evidence supports the claimed hours
2. **Mismatch check (B):** Compare task description keywords/domain against commit projects and messages
3. **Outlier check (C):** Compare member's hours-to-commits ratio against team average

**Output format:** Claude writes `task-analysis.json`:
```json
{
  "analysisDate": "2026-03-16",
  "period": "3/13",
  "warnings": [
    {
      "date": "3/13",
      "member": "某人",
      "severity": "🔴|🟡|🟠",
      "type": "low_output|mismatch|outlier",
      "task": "新功能開發 (4H)",
      "commits": "1 commit: fix typo in README",
      "reasoning": "報告 4 小時新功能開發，但當天僅有 1 筆 typo 修正 commit，產出與時數不成比例"
    }
  ],
  "summary": {
    "totalMembers": 14,
    "totalWarnings": 3,
    "byType": { "low_output": 1, "mismatch": 1, "outlier": 1 }
  }
}
```

### Component 3: Dashboard Display

**Location:** CommitsView, new section between consistency grid and project participation chart.

**UI:** Warning cards with severity color coding (reuse `SEVERITY_COLORS`):
- Header: "任務合理性警示" with warning count badge
- Each warning card shows: member, date, task, evidence, reasoning
- Collapsible by default if no warnings
- Gracefully hidden if `task-analysis.json` is missing (same pattern as gitlab-commits.json)

### Severity Rules

| Severity | Condition |
|----------|-----------|
| 🔴 Critical | Dev task ≥3H with 0 related commits |
| 🟡 Warning | Dev task hours vs commit output significantly below team average (>2 std dev) |
| 🟠 Caution | Task description domain doesn't match commit projects |

### What Doesn't Trigger Warnings

- Meeting-only hours (no commits expected)
- Members on leave
- Non-dev tasks (code review, planning, documentation explicitly stated)
- Days with no commit data available

## Files Changed

| File | Change |
|------|--------|
| `scripts/prepare-task-analysis.js` | New — data preparation script |
| `task-analysis.json` | New — analysis output (gitignored) |
| `index.html` | Add warnings section to CommitsView |
| `appscript/index.html` | Sync with index.html changes |
| `.gitignore` | Add `task-analysis.json` |

## Future Considerations

- Integrate into `/sync` skill for automated analysis
- Historical trend tracking (repeated warnings for same member)
- Configurable thresholds
