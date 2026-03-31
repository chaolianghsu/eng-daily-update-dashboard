# Week Navigator — DailyView 週切換器

## Summary

在「每日工時」tab 中新增週導航功能，讓使用者可以切換本週、上週、或更早有資料的週次。採用箭頭導航 + 快捷 pill + 可展開下拉的組合方案。

## UI Layout

```
◀  [本週 3/24 – 3/28 ▾]  ▶    [本週] [上週]
   3/24（一） 3/25（二） 3/26（三） ...
```

- **◀ ▶ 箭頭**：逐週翻頁，限制在有資料的週範圍內
- **週標籤**：顯示當前選擇的週範圍，可點擊展開下拉選單
- **本週/上週 pill**：快捷按鈕，快速跳到最近兩週
- **日期按鈕列**：現有功能不變，顯示選定週的工作日

## Interactions

| Action | Behavior |
|--------|----------|
| Click ◀ | Navigate to previous week (within data range) |
| Click ▶ | Navigate to next week |
| Click "本週" pill | Jump to latest week |
| Click "上週" pill | Jump to second-latest week |
| Click week label | Open dropdown listing all available weeks |
| Select from dropdown | Jump to that week, close dropdown |
| Click outside dropdown | Close dropdown |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Only one week of data | ◀ ▶ both disabled, 上週 pill disabled |
| Already on latest week | ▶ disabled, 本週 pill shows active state |
| Already on earliest week | ◀ disabled |
| Week has partial data (some days missing) | Date buttons still shown, member cards show "—" |

## Architecture

### New: `useWeekNavigator` hook

Replaces the existing `useCurrentWeek` hook.

**Input:** `dates: string[]` (all available dates from rawData)

**Computed state:**
- `weeks`: Array of `{ dates: string[], monday: Date, friday: Date, label: string }` — all available weeks grouped by Mon-Fri, sorted chronologically
- `weekIndex`: Current selected week index (0 = earliest, last = latest). Defaults to latest week.

**Returned API:**
- `currentWeek`: The selected week object (`{ dates, label }`)
- `weeks`: All available weeks (for dropdown)
- `weekIndex`: Current index
- `canGoPrev`: boolean — false when at earliest week
- `canGoNext`: boolean — false when at latest week
- `goToPrev()`: Navigate to previous week
- `goToNext()`: Navigate to next week
- `goToWeek(index)`: Jump to specific week by index
- `goToThisWeek()`: Jump to latest week
- `goToLastWeek()`: Jump to second-latest week (no-op if only one week)
- `isThisWeek`: boolean — true when viewing latest week
- `isLastWeek`: boolean — true when viewing second-latest week

**Week grouping logic:**
1. Parse all dates from rawData keys
2. For each date, compute which Mon-Fri week it belongs to (using existing `getWeekRange`)
3. Group dates by week, sort weeks chronologically
4. Default selection: latest week (highest index)

### Modified: `DailyView` component

**New props:**
- `weeks`: All available weeks for dropdown
- `weekIndex`: Current week index
- `canGoPrev`, `canGoNext`: Arrow enable state
- `isThisWeek`, `isLastWeek`: Pill active state
- `onPrevWeek`, `onNextWeek`: Arrow callbacks
- `onThisWeek`, `onLastWeek`: Pill callbacks
- `onSelectWeek(index)`: Dropdown selection callback

**New internal state:**
- `dropdownOpen`: boolean for week dropdown visibility

**Removed props:**
- `weekLabel` — replaced by computed label from `weeks[weekIndex]`

### Modified: `App.tsx`

- Replace `useCurrentWeek(dates)` with `useWeekNavigator(dates)`
- Pass new navigation props to `DailyView`
- `dailyDates` and `activeDate` logic derived from `navigator.currentWeek.dates`

### Unchanged

- `useDailyBarData` — no changes, receives `activeDate` as before
- Chart rendering, member cards, commit badges — all unchanged
- Other tabs (Trend, Weekly, Commits, Plan Tracking) — not affected
- `getWeekRange` utility — reused by new hook

## Visual Style

- Arrows: `color: COLORS.textDim`, hover `COLORS.text`, disabled `COLORS.border` with `cursor: default`
- Week label: clickable, subtle hover underline, `▾` indicator
- Dropdown: `background: COLORS.card`, `border: 1px solid COLORS.border`, `border-radius: 10px`, max-height with scroll, shadow
- Active week in dropdown: left accent border `COLORS.accent`
- Pills: same style as existing date buttons — active has `border: 2px solid COLORS.accent` + blue tint background
- Disabled pill: `opacity: 0.4`, `cursor: default`

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useWeekNavigator.ts` | **New** — replaces `useCurrentWeek` |
| `src/hooks/useCurrentWeek.ts` | **Delete** |
| `src/views/DailyView.tsx` | Add week navigator UI (arrows, pills, dropdown) |
| `src/App.tsx` | Switch from `useCurrentWeek` to `useWeekNavigator`, pass new props |

## Testing

- `useWeekNavigator`: Unit tests for week grouping, navigation bounds, edge cases (1 week, many weeks, partial weeks)
- `DailyView`: Rendering tests for arrow disabled states, pill active states, dropdown open/close
- Existing tests: Update any tests that reference `useCurrentWeek` to use `useWeekNavigator`
