# Issue Ticker & Weekly Stats Redesign

## Issue Ticker → Team Status Overview

### Layout
- Two-column layout (left: team KPIs, right: attention cards)
- Bottom row: stable members as compact tags

### Left: Team KPIs (3 metrics)
- **Report rate**: `N/M` with color (green if full, yellow/red if missing)
- **Team avg hours**: number + inline mini progress bar (0-10 scale)
- **Attention count**: number of non-green members

### Right: Attention Cards (red/yellow/orange only)
Each card shows severity dot, member name, issue text, and a neutral action hint:
- Overtime → "留意工作量分配"
- Unreported → "請確認是否需要協助"
- Consecutive unreported → "建議主動聯繫"
- Low hours → "建議了解狀況"
- On leave → date range only, no action hint

### Bottom Row
Green (stable) members listed as small inline tags: "穩定：Ivy, 日銜, Wendy..."
Lowest visual weight.

### RWD
Mobile: left/right columns stack vertically (KPIs on top, attention cards below).

## Weekly Stats Redesign

### Chart
- Replace single-color avg bar with stacked bar (dev + meeting), consistent with daily view
- Requires adding `devAvg` and `meetAvg` to `weeklySummary` computation

### Table Enhancements
Columns: 成員, 回報, 總工時, 日均, 會議, 會議%, 穩定度, 趨勢

Changes from current:
- **日均**: add heatmap background color (same style as trend view table)
- **穩定度**: replace StatusBadge with progress bar + std dev number (same as trend view)
- **回報**: red background when daysReported < total dates
- **會議%**: yellow background when > 50%
- Clickable rows with highlight (same interaction as trend table)
- Remove StatusBadge column (redundant with heatmap colors)

### Data Changes
Add to `weeklySummary` memo:
- `devAvg`: average dev hours per reported day
- `meetAvg`: average meeting hours per reported day
- `stdDev`: standard deviation of daily totals
- `stabilityPct`: derived from stdDev (same formula as trend view)

## Files Modified
- `index.html`: Issue Ticker component, Weekly view component, weeklySummary memo
- `appscript/index.html`: sync changes
