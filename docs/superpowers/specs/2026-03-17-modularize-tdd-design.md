# Phase B+C: Modularize App.tsx + TDD Test Coverage

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Split App.tsx into views + custom hooks, add unit and component tests via Red-Green TDD
**Depends on**: Phase A (Bun + Vite + TypeScript) — completed

## Problem

After Phase A, `App.tsx` is 834 lines containing three view tab implementations, five `useMemo` computation blocks, a Team Status Overview IIFE (~95 lines), and all state management. No frontend tests exist — the existing tests only cover backend scripts. This makes refactoring risky and regressions invisible.

## Solution

1. Extract `useMemo` blocks into custom hooks (independently testable)
2. Extract view tab JSX into separate view components
3. Add comprehensive tests using Red-Green TDD: failing test first, then minimal implementation

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Split granularity | Views + custom hooks | Hooks are TDD-friendly units; views become thin render layers |
| Test levels | Unit (utils, hooks) + Component (views) | Good coverage without integration test complexity |
| TDD approach | Red-Green | Write failing test → extract code to make it pass → refactor |
| Test tools | Vitest + @testing-library/react + jsdom | Already using Vitest; RTL is the standard for React testing |
| Recharts in tests | Mock as simple div | Avoids SVG rendering complexity in jsdom |

## File Structure After Refactoring

```
src/
├── App.tsx               ← ~150 lines (state, routing, layout)
├── views/
│   ├── StatusOverview.tsx ← Team KPIs + attention cards (~100 lines)
│   ├── DailyView.tsx     ← Daily tab (~100 lines)
│   ├── TrendView.tsx     ← Trend tab (~280 lines)
│   └── WeeklyView.tsx    ← Weekly tab (~110 lines)
├── hooks/
│   ├── useCurrentWeek.ts
│   ├── useDailyBarData.ts
│   ├── useTrendData.ts
│   ├── useWeeklySummary.ts
│   └── useAllIssues.ts
├── CommitsView.tsx       ← Unchanged (508 lines, already independent)
├── components.tsx        ← Unchanged
├── constants.ts          ← Unchanged
├── utils.ts              ← Unchanged
├── types.ts              ← Unchanged (may add hook return types)
├── styles.css            ← Unchanged
├── main.tsx              ← Unchanged
├── main.appscript.tsx    ← Unchanged
└── google.script.d.ts    ← Unchanged

tests/
├── unit/
│   ├── utils.test.ts
│   ├── constants.test.ts
│   └── hooks/
│       ├── useCurrentWeek.test.ts
│       ├── useDailyBarData.test.ts
│       ├── useTrendData.test.ts
│       ├── useWeeklySummary.test.ts
│       └── useAllIssues.test.ts
├── components/
│   ├── components.test.tsx
│   ├── StatusOverview.test.tsx
│   ├── DailyView.test.tsx
│   ├── TrendView.test.tsx
│   └── WeeklyView.test.tsx
├── data-schema.test.js       ← Existing, unchanged
├── merge-daily-data.test.js  ← Existing, unchanged
├── fetch-gitlab-commits.test.js ← Existing, unchanged
├── backfill.test.js          ← Existing, unchanged
└── index-loading.test.js     ← Existing, unchanged
```

## Custom Hooks

### useCurrentWeek

**Source:** App.tsx lines 61-89 (`currentWeek` useMemo)

```typescript
// src/hooks/useCurrentWeek.ts
import { useMemo } from "react";
import { getWeekRange } from "../utils";

interface CurrentWeekResult {
  dates: string[];
  label: string;
}

export function useCurrentWeek(dates: string[]): CurrentWeekResult {
  return useMemo(() => {
    if (!dates.length) return { dates: [], label: "" };
    // ... existing logic from App.tsx
  }, [dates]);
}
```

**Input:** `dates: string[]` (all available dates from rawData)
**Output:** `{ dates: string[], label: string }` (filtered week dates + display label)
**Test cases:**
- Empty dates → empty result
- Dates within current week → returns those dates with "本週" label
- No dates in current week → falls back to latest week with range label

### useDailyBarData

**Source:** App.tsx lines 98-104 (`dailyBarData` useMemo)

```typescript
// src/hooks/useDailyBarData.ts
export function useDailyBarData(
  rawData: Record<string, Record<string, any>> | null,
  activeDate: string,
  members: string[]
): Array<{ name: string; 開發: number | null; 會議: number | null; total: number | null }>
```

**Test cases:**
- null rawData → empty array
- Members with data → sorted by total descending
- Missing member data → null values

### useTrendData

**Source:** App.tsx lines 106-155 (`trendDates`, `trendData` useMemos + `useWeeklyAgg` derived const + `weekGroups` useMemo)

```typescript
// src/hooks/useTrendData.ts
interface TrendDataResult {
  trendDates: string[];
  trendData: any[];
  useWeeklyAgg: boolean;
  weekGroups: Array<{ key: string; label: string; dates: string[] }>;
}

export function useTrendData(
  rawData: Record<string, Record<string, any>> | null,
  dates: string[],
  members: string[],
  dayLabels: Record<string, string>,
  commitData: CommitData | null,
  trendRange: string
): TrendDataResult
```

**Test cases:**
- trendRange "week" → last 5 dates
- trendRange "2weeks" → last 10 dates
- trendRange "month" → useWeeklyAgg = true, weekGroups populated
- Team average calculated correctly
- Commit data merged into trend rows when available

### useWeeklySummary

**Source:** App.tsx lines 157-180 (`weeklySummary` useMemo)

```typescript
// src/hooks/useWeeklySummary.ts
interface WeeklySummaryItem {
  name: string;
  avg: number | null;
  sum: number | null;
  devAvg: number | null;
  meetAvg: number | null;
  daysReported: number;
  meetSum: number;
  meetPct: number;
  trend: string;
  stdDev: number | null;
  stabilityPct: number;
  stabilityColor: string;
}

export function useWeeklySummary(
  rawData: Record<string, Record<string, any>> | null,
  dates: string[],
  members: string[]
): WeeklySummaryItem[]
```

**Test cases:**
- null rawData → empty array
- Single member, single day → avg = that value
- Multiple days → correct avg, stdDev, stabilityPct
- Sorted by avg descending
- Meeting percentage calculated correctly
- Trend icon based on first vs last date

### useAllIssues

**Source:** App.tsx lines 182-192 (`allIssues` useMemo)

```typescript
// src/hooks/useAllIssues.ts
export function useAllIssues(
  issues: Issue[],
  commitData: CommitData | null,
  activeDate: string
): Issue[]
```

**Test cases:**
- Filters out green (🟢) issues
- Without commitData → returns filtered base issues
- With commitData showing 🔴 status → appends commit warning issue
- No duplicates

## View Components

### StatusOverview

**Source:** App.tsx lines 231-326 (Team Status Overview IIFE)

```typescript
// src/views/StatusOverview.tsx
interface StatusOverviewProps {
  allIssues: Issue[];
  issues: Issue[];
  members: string[];
  rawData: Record<string, Record<string, any>>;
  dates: string[];
}
```

**Test cases:**
- Renders reporting rate (reportedCount / total members)
- Renders team average with correct color
- Shows attention count
- Renders attention issue cards with severity colors
- Shows "全員狀態正常" when no attention issues
- Renders stable member section when green issues exist

### DailyView

**Source:** App.tsx lines 342-433 (`view === "daily"` block)

```typescript
// src/views/DailyView.tsx
interface DailyViewProps {
  dailyDates: string[];
  activeDate: string;
  onDateSelect: (d: string) => void;
  dayLabels: Record<string, string>;
  weekLabel: string;
  dailyBarData: any[];
  chartHeight: number;
  memberColors: Record<string, string>;
  issueMap: Record<string, any>;
  commitData: CommitData | null;
  leave: Record<string, any[]>;
}
```

**Test cases (component):**
- Renders date buttons for each dailyDate
- Active date button has accent styling
- Renders member cards with correct names
- Shows commit badge when commitData present

### TrendView

**Source:** App.tsx lines 435-714 (`view === "trend"` block)

```typescript
// src/views/TrendView.tsx
interface TrendViewProps {
  trendRange: string;
  onTrendRangeChange: (r: string) => void;
  trendDates: string[];
  trendData: any[];
  useWeeklyAgg: boolean;
  weekGroups: any[];
  members: string[];
  memberColors: Record<string, string>;
  selectedMembers: Set<string>;
  onToggleMember: (m: string) => void;
  onClearMembers: () => void;
  isMobile: boolean;
  commitData: CommitData | null;
  rawData: Record<string, Record<string, any>>;
  leave: Record<string, any[]>;
}
```

**Test cases (component):**
- Renders time range buttons (1週, 2週, 1月, 全部)
- Active range button highlighted
- Renders member selection chips
- Shows "清除" button when members selected
- Weekly table rendered when useWeeklyAgg = true
- Daily table rendered when useWeeklyAgg = false

### WeeklyView

**Source:** App.tsx lines 716-814 (`view === "weekly"` block)

```typescript
// src/views/WeeklyView.tsx
interface WeeklyViewProps {
  weeklySummary: WeeklySummaryItem[];
  chartHeight: number;
  members: string[];
  memberColors: Record<string, string>;
  selectedMembers: Set<string>;
  onToggleMember: (m: string) => void;
  isMobile: boolean;
  dates: string[];
}
```

**Test cases (component):**
- Renders table with correct column headers
- Displays member stats (回報, 總工時, 日均, etc.)
- Meeting percentage warning when > 50%
- Stability bar rendered with correct color

## Test Infrastructure

### Dependencies to Add

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "jsdom": "^25.0.0"
  }
}
```

### Vitest Config Update

Add `test` block to the existing `vite.config.ts`. Use `environmentMatchGlobs` to only apply jsdom to frontend tests, keeping existing script tests in Node environment:

```typescript
// vite.config.ts (add test block)
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  test: {
    environment: "node", // default for existing tests
    environmentMatchGlobs: [
      ["tests/unit/**", "jsdom"],
      ["tests/components/**", "jsdom"],
    ],
    setupFiles: ["tests/setup.ts"],
  },
});
```

### Test Setup

```typescript
// tests/setup.ts
import "@testing-library/jest-dom/vitest";
```

### Recharts Mock

```typescript
// tests/__mocks__/recharts.tsx
// Mock all Recharts components as simple divs
// Avoids SVG rendering complexity in jsdom
export const BarChart = ({ children, ...props }: any) => <div data-testid="bar-chart" {...props}>{children}</div>;
export const Bar = (props: any) => <div data-testid="bar" />;
// ... etc for all used Recharts components
```

## TDD Execution Order

Red-Green cycle for each module:

1. **utils.test.ts** — utils.ts already exists → write tests to verify (green start, establishes test infrastructure)
2. **constants.test.ts** — constants.ts already exists → write tests to verify
3. **useCurrentWeek.test.ts** → RED: write test → GREEN: extract hook from App.tsx
4. **useDailyBarData.test.ts** → RED → GREEN: extract hook
5. **useTrendData.test.ts** → RED → GREEN: extract hook
6. **useWeeklySummary.test.ts** → RED → GREEN: extract hook
7. **useAllIssues.test.ts** → RED → GREEN: extract hook
8. **Refactor App.tsx** — replace useMemo blocks with hook calls, verify no regressions
9. **components.test.tsx** → write tests for existing components (green start)
10. **StatusOverview.test.tsx** → RED → GREEN: extract from App.tsx IIFE
11. **DailyView.test.tsx** → RED → GREEN: extract view from App.tsx
12. **TrendView.test.tsx** → RED → GREEN: extract view
13. **WeeklyView.test.tsx** → RED → GREEN: extract view
14. **Refactor App.tsx** — replace view JSX with component calls, final slim-down

## Acceptance Criteria

- [ ] App.tsx reduced to ~150 lines (state + routing + layout)
- [ ] 5 custom hooks independently testable
- [ ] 3 view components independently testable
- [ ] All hook tests pass with `bun test`
- [ ] All component tests pass with `bun test`
- [ ] All existing 48 tests still pass
- [ ] `bun run build` succeeds
- [ ] `bun run dev` — all 4 tabs render identically to pre-refactor
- [ ] Test-to-frontend-code ratio >= 0.5:1
