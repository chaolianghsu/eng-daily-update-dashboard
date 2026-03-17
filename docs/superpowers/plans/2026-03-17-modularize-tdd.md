# Modularize App.tsx + TDD Test Coverage — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split App.tsx (834 lines) into custom hooks + view components, adding comprehensive tests via Red-Green TDD.

**Architecture:** Extract 5 useMemo blocks into custom hooks under `src/hooks/`, extract 4 view blocks (StatusOverview, Daily, Trend, Weekly) into `src/views/`. Each extraction follows TDD: write failing test first, then extract code to make it pass. App.tsx becomes a thin shell (~120 lines) of state + routing.

**Tech Stack:** Vitest, @testing-library/react, jsdom, renderHook

**Spec:** `docs/superpowers/specs/2026-03-17-modularize-tdd-design.md`

---

## Chunk 1: Test Infrastructure + Utils/Constants Tests

### Task 1: Set up test infrastructure

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/__mocks__/recharts.tsx`

- [ ] **Step 1: Install test dependencies**

```bash
bun install -d @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Update vite.config.ts with test config**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/unit/**", "jsdom"],
      ["tests/components/**", "jsdom"],
    ],
    setupFiles: ["tests/setup.ts"],
  },
});
```

- [ ] **Step 3: Create tests/setup.ts**

```typescript
// tests/setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Create Recharts mock**

```tsx
// tests/__mocks__/recharts.tsx
import React from "react";

const mock = (name: string) => {
  const Component = ({ children, ...props }: any) => (
    <div data-testid={name} {...props}>{children}</div>
  );
  Component.displayName = name;
  return Component;
};

export const BarChart = mock("BarChart");
export const Bar = mock("Bar");
export const XAxis = mock("XAxis");
export const YAxis = mock("YAxis");
export const CartesianGrid = mock("CartesianGrid");
export const Tooltip = mock("Tooltip");
export const Legend = mock("Legend");
export const ResponsiveContainer = mock("ResponsiveContainer");
export const ReferenceLine = mock("ReferenceLine");
export const Cell = mock("Cell");
export const LineChart = mock("LineChart");
export const Line = mock("Line");
export const ComposedChart = mock("ComposedChart");
export const Area = mock("Area");
export const ScatterChart = mock("ScatterChart");
export const Scatter = mock("Scatter");
export const ZAxis = mock("ZAxis");
export const LabelList = mock("LabelList");
```

- [ ] **Step 5: Verify existing tests still pass**

```bash
bun test
```

Expected: All 48 existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock vite.config.ts tests/setup.ts tests/__mocks__/recharts.tsx
git commit -m "chore: add test infrastructure for React component testing"
```

### Task 2: Test utils.ts (green start)

**Files:**
- Create: `tests/unit/utils.test.ts`

- [ ] **Step 1: Write utils tests**

```typescript
// tests/unit/utils.test.ts
import { describe, it, expect } from "vitest";
import { dateToNum, isOnLeave, getStatus, getBarColor, getTrendIcon, getWeekRange } from "../../src/utils";

describe("dateToNum", () => {
  it("converts M/D to sortable number", () => {
    expect(dateToNum("3/5")).toBe(305);
    expect(dateToNum("12/31")).toBe(1231);
  });

  it("sorts correctly", () => {
    expect(dateToNum("3/9")).toBeGreaterThan(dateToNum("3/5"));
    expect(dateToNum("4/1")).toBeGreaterThan(dateToNum("3/31"));
  });
});

describe("isOnLeave", () => {
  it("returns false for no leave ranges", () => {
    expect(isOnLeave("3/5")).toBe(false);
    expect(isOnLeave("3/5", undefined)).toBe(false);
  });

  it("returns true when date falls in range", () => {
    expect(isOnLeave("3/5", [{ start: "3/3", end: "3/7" }])).toBe(true);
  });

  it("returns false when date outside range", () => {
    expect(isOnLeave("3/8", [{ start: "3/3", end: "3/7" }])).toBe(false);
  });

  it("handles boundary dates", () => {
    expect(isOnLeave("3/3", [{ start: "3/3", end: "3/7" }])).toBe(true);
    expect(isOnLeave("3/7", [{ start: "3/3", end: "3/7" }])).toBe(true);
  });
});

describe("getStatus", () => {
  it("returns 休假 for null hours on leave", () => {
    const s = getStatus(null, true);
    expect(s.label).toBe("休假");
  });

  it("returns 未回報 for null hours not on leave", () => {
    expect(getStatus(null).label).toBe("未回報");
  });

  it("returns 超時 for hours > 10", () => {
    expect(getStatus(10.5).label).toBe("超時");
  });

  it("returns 合理 for hours in normal range", () => {
    expect(getStatus(7.5).label).toBe("合理");
  });

  it("returns 不足 for very low hours", () => {
    expect(getStatus(3).label).toBe("不足");
  });
});

describe("getBarColor", () => {
  it("returns textDim for null", () => {
    expect(getBarColor(null)).toContain("64748b");
  });

  it("returns yellow for high hours", () => {
    expect(getBarColor(9)).toContain("eab308");
  });
});

describe("getTrendIcon", () => {
  it("returns — for null values", () => {
    expect(getTrendIcon(null, 5)).toBe("—");
    expect(getTrendIcon(5, null)).toBe("—");
  });

  it("returns 📈 for large increase", () => {
    expect(getTrendIcon(5, 7)).toBe("📈");
  });

  it("returns ➡️ for no change", () => {
    expect(getTrendIcon(8, 8)).toBe("➡️");
  });
});

describe("getWeekRange", () => {
  it("returns monday-friday for a wednesday", () => {
    const wed = new Date(2026, 2, 11); // Wed Mar 11, 2026
    const { monday, friday } = getWeekRange(wed);
    expect(monday.getDay()).toBe(1); // Monday
    expect(friday.getDay()).toBe(5); // Friday
    expect(monday.getDate()).toBe(9);
    expect(friday.getDate()).toBe(13);
  });

  it("handles sunday correctly", () => {
    const sun = new Date(2026, 2, 15); // Sun Mar 15, 2026
    const { monday } = getWeekRange(sun);
    expect(monday.getDate()).toBe(9); // Previous Monday
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/utils.test.ts
```

Expected: All PASS (green start — code already exists).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/utils.test.ts
git commit -m "test: add unit tests for utils.ts"
```

### Task 3: Test constants.ts (green start)

**Files:**
- Create: `tests/unit/constants.test.ts`

- [ ] **Step 1: Write constants tests**

```typescript
// tests/unit/constants.test.ts
import { describe, it, expect } from "vitest";
import { COLORS, SEVERITY_COLORS, THRESHOLDS, WEEK_DAYS, MEMBER_PALETTE, PROJECT_PALETTE } from "../../src/constants";

describe("SEVERITY_COLORS", () => {
  it("maps all four severity emojis", () => {
    expect(SEVERITY_COLORS["🔴"]).toBeDefined();
    expect(SEVERITY_COLORS["🟡"]).toBeDefined();
    expect(SEVERITY_COLORS["🟠"]).toBeDefined();
    expect(SEVERITY_COLORS["🟢"]).toBeDefined();
  });

  it("each has sc and bg properties", () => {
    for (const [, value] of Object.entries(SEVERITY_COLORS)) {
      expect(value).toHaveProperty("sc");
      expect(value).toHaveProperty("bg");
    }
  });

  it("red severity uses COLORS.red", () => {
    expect(SEVERITY_COLORS["🔴"].sc).toBe(COLORS.red);
    expect(SEVERITY_COLORS["🔴"].bg).toBe(COLORS.redDim);
  });
});

describe("THRESHOLDS", () => {
  it("has correct ordering", () => {
    expect(THRESHOLDS.low).toBeLessThan(THRESHOLDS.ok);
    expect(THRESHOLDS.ok).toBeLessThan(THRESHOLDS.target);
    expect(THRESHOLDS.target).toBeLessThan(THRESHOLDS.high);
    expect(THRESHOLDS.high).toBeLessThan(THRESHOLDS.overtime);
  });
});

describe("WEEK_DAYS", () => {
  it("has 7 entries starting with 日", () => {
    expect(WEEK_DAYS).toHaveLength(7);
    expect(WEEK_DAYS[0]).toBe("日");
    expect(WEEK_DAYS[1]).toBe("一");
  });
});

describe("Palettes", () => {
  it("MEMBER_PALETTE has 16 colors", () => {
    expect(MEMBER_PALETTE).toHaveLength(16);
  });

  it("PROJECT_PALETTE has 10 colors", () => {
    expect(PROJECT_PALETTE).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/constants.test.ts
```

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/constants.test.ts
git commit -m "test: add unit tests for constants.ts"
```

---

## Chunk 2: Custom Hooks (TDD Red-Green)

### Task 4: useAllIssues hook (simplest hook, good TDD warmup)

**Files:**
- Create: `tests/unit/hooks/useAllIssues.test.ts`
- Create: `src/hooks/useAllIssues.ts`
- Modify: `src/App.tsx:182-192`

- [ ] **Step 1: Write failing test (RED)**

```typescript
// tests/unit/hooks/useAllIssues.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAllIssues } from "../../../src/hooks/useAllIssues";

describe("useAllIssues", () => {
  it("filters out green issues", () => {
    const issues = [
      { member: "A", severity: "🔴", text: "超時" },
      { member: "B", severity: "🟢", text: "穩定" },
    ];
    const { result } = renderHook(() => useAllIssues(issues, null, "3/5"));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].member).toBe("A");
  });

  it("returns filtered base when no commitData", () => {
    const issues = [{ member: "A", severity: "🟡", text: "偏低" }];
    const { result } = renderHook(() => useAllIssues(issues, null, "3/5"));
    expect(result.current).toHaveLength(1);
  });

  it("appends commit warning for 🔴 status", () => {
    const issues: any[] = [];
    const commitData = {
      commits: {},
      analysis: { "3/5": { "Bob": { status: "🔴", commitCount: 5, hours: null } } },
      projectRisks: [],
    };
    const { result } = renderHook(() => useAllIssues(issues, commitData as any, "3/5"));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].member).toBe("Bob");
    expect(result.current[0].text).toContain("5 commits");
  });

  it("does not append for non-🔴 status", () => {
    const commitData = {
      commits: {},
      analysis: { "3/5": { "Bob": { status: "✅", commitCount: 3, hours: 8 } } },
      projectRisks: [],
    };
    const { result } = renderHook(() => useAllIssues([], commitData as any, "3/5"));
    expect(result.current).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/hooks/useAllIssues.test.ts
```

Expected: FAIL — module `../../../src/hooks/useAllIssues` not found.

- [ ] **Step 3: Create the hook (GREEN)**

```typescript
// src/hooks/useAllIssues.ts
import { useMemo } from "react";
import type { Issue, CommitData } from "../types";

export function useAllIssues(
  issues: Issue[],
  commitData: CommitData | null,
  activeDate: string
): Issue[] {
  return useMemo(() => {
    const base = issues.filter(i => i.severity !== '🟢');
    if (!commitData) return base;
    const activeAnalysis = commitData.analysis?.[activeDate] || {};
    for (const [m, a] of Object.entries(activeAnalysis)) {
      if (a.status === '🔴') {
        base.push({ member: m, severity: '🔴', text: `有 ${a.commitCount} commits 但未回報工時` });
      }
    }
    return base;
  }, [issues, commitData, activeDate]);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/unit/hooks/useAllIssues.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Replace in App.tsx**

In `src/App.tsx`, add import:
```typescript
import { useAllIssues } from "./hooks/useAllIssues";
```

Replace lines 182-192 (the `allIssues` useMemo block) with:
```typescript
  const allIssues = useAllIssues(issues, commitData, activeDate);
```

- [ ] **Step 6: Verify full test suite**

```bash
bun test
```

Expected: All tests pass (existing 48 + new hook tests).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAllIssues.ts tests/unit/hooks/useAllIssues.test.ts src/App.tsx
git commit -m "feat: extract useAllIssues hook with TDD tests"
```

### Task 5: useDailyBarData hook

**Files:**
- Create: `tests/unit/hooks/useDailyBarData.test.ts`
- Create: `src/hooks/useDailyBarData.ts`
- Modify: `src/App.tsx:98-104`

- [ ] **Step 1: Write failing test (RED)**

```typescript
// tests/unit/hooks/useDailyBarData.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDailyBarData } from "../../../src/hooks/useDailyBarData";

describe("useDailyBarData", () => {
  it("returns empty array for null rawData", () => {
    const { result } = renderHook(() => useDailyBarData(null, "3/5", ["A"]));
    expect(result.current).toEqual([]);
  });

  it("returns empty array for empty activeDate", () => {
    const { result } = renderHook(() => useDailyBarData({}, "", ["A"]));
    expect(result.current).toEqual([]);
  });

  it("maps member data correctly", () => {
    const rawData = {
      "3/5": {
        "Alice": { total: 8, meeting: 2, dev: 6 },
        "Bob": { total: 6, meeting: 1, dev: 5 },
      },
    };
    const { result } = renderHook(() => useDailyBarData(rawData, "3/5", ["Alice", "Bob"]));
    expect(result.current).toHaveLength(2);
    expect(result.current[0].name).toBe("Alice"); // sorted by total desc
    expect(result.current[0].total).toBe(8);
    expect(result.current[0]["開發"]).toBe(6);
    expect(result.current[0]["會議"]).toBe(2);
  });

  it("sorts by total descending", () => {
    const rawData = {
      "3/5": {
        "A": { total: 5, meeting: 1, dev: 4 },
        "B": { total: 9, meeting: 2, dev: 7 },
      },
    };
    const { result } = renderHook(() => useDailyBarData(rawData, "3/5", ["A", "B"]));
    expect(result.current[0].name).toBe("B");
    expect(result.current[1].name).toBe("A");
  });

  it("handles missing member data with nulls", () => {
    const rawData = { "3/5": {} };
    const { result } = renderHook(() => useDailyBarData(rawData, "3/5", ["A"]));
    expect(result.current[0].total).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
bun test tests/unit/hooks/useDailyBarData.test.ts
```

- [ ] **Step 3: Create the hook (GREEN)**

```typescript
// src/hooks/useDailyBarData.ts
import { useMemo } from "react";

export function useDailyBarData(
  rawData: Record<string, Record<string, any>> | null,
  activeDate: string,
  members: string[]
) {
  return useMemo(() => {
    if (!rawData || !activeDate) return [];
    return members.map(m => {
      const d = rawData[activeDate]?.[m] || { total: null, meeting: null, dev: null };
      return { name: m, 開發: d.dev, 會議: d.meeting, total: d.total };
    }).sort((a, b) => (b.total || -1) - (a.total || -1));
  }, [rawData, activeDate, members]);
}
```

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Replace in App.tsx**

Import `useDailyBarData` and replace lines 98-104 with:
```typescript
  const dailyBarData = useDailyBarData(rawData, activeDate, members);
```

- [ ] **Step 6: Run full test suite — all pass**

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useDailyBarData.ts tests/unit/hooks/useDailyBarData.test.ts src/App.tsx
git commit -m "feat: extract useDailyBarData hook with TDD tests"
```

### Task 6: useCurrentWeek hook

**Files:**
- Create: `tests/unit/hooks/useCurrentWeek.test.ts`
- Create: `src/hooks/useCurrentWeek.ts`
- Modify: `src/App.tsx:61-89`

- [ ] **Step 1: Write failing test (RED)**

```typescript
// tests/unit/hooks/useCurrentWeek.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCurrentWeek } from "../../../src/hooks/useCurrentWeek";

describe("useCurrentWeek", () => {
  it("returns empty for no dates", () => {
    const { result } = renderHook(() => useCurrentWeek([]));
    expect(result.current.dates).toEqual([]);
    expect(result.current.label).toBe("");
  });

  it("filters dates within current week", () => {
    // Mock Date to Wednesday March 11, 2026
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 11));

    const dates = ["3/5", "3/6", "3/9", "3/10", "3/11", "3/12", "3/13"];
    const { result } = renderHook(() => useCurrentWeek(dates));

    // Week of 3/9-3/13
    expect(result.current.dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);
    expect(result.current.label).toContain("本週");

    vi.useRealTimers();
  });

  it("falls back to latest week when current week has no data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18)); // March 18 (next week)

    const dates = ["3/9", "3/10", "3/11"];
    const { result } = renderHook(() => useCurrentWeek(dates));

    expect(result.current.dates).toEqual(["3/9", "3/10", "3/11"]);
    expect(result.current.label).toContain("週");
    expect(result.current.label).not.toContain("本週");

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Create the hook (GREEN)**

```typescript
// src/hooks/useCurrentWeek.ts
import { useMemo } from "react";
import { getWeekRange } from "../utils";

export function useCurrentWeek(dates: string[]): { dates: string[]; label: string } {
  return useMemo(() => {
    if (!dates.length) return { dates: [], label: "" };
    const year = new Date().getFullYear();
    const { monday, friday } = getWeekRange(new Date());

    let weekDates = dates.filter(d => {
      const [m, dd] = d.split('/').map(Number);
      const date = new Date(year, m - 1, dd);
      return date >= monday && date <= friday;
    });

    const fmtDate = (dt: Date) => `${dt.getMonth()+1}/${dt.getDate()}`;
    let label = `本週 ${fmtDate(monday)} – ${fmtDate(friday)}`;

    if (weekDates.length === 0 && dates.length > 0) {
      const latest = dates[dates.length - 1];
      const [lm, ld] = latest.split('/').map(Number);
      const latestDate = new Date(year, lm - 1, ld);
      const { monday: pMon, friday: pFri } = getWeekRange(latestDate);
      weekDates = dates.filter(d => {
        const [m, dd] = d.split('/').map(Number);
        const date = new Date(year, m - 1, dd);
        return date >= pMon && date <= pFri;
      });
      label = `${fmtDate(pMon)} – ${fmtDate(pFri)} 週`;
    }

    return { dates: weekDates, label };
  }, [dates]);
}
```

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Replace in App.tsx and commit**

Replace the `currentWeek` useMemo block (lines 61-89) with:
```typescript
  const currentWeek = useCurrentWeek(dates);
```

```bash
git add src/hooks/useCurrentWeek.ts tests/unit/hooks/useCurrentWeek.test.ts src/App.tsx
git commit -m "feat: extract useCurrentWeek hook with TDD tests"
```

### Task 7: useWeeklySummary hook

**Files:**
- Create: `tests/unit/hooks/useWeeklySummary.test.ts`
- Create: `src/hooks/useWeeklySummary.ts`
- Modify: `src/App.tsx` (weeklySummary useMemo block)

- [ ] **Step 1: Write failing test (RED)**

```typescript
// tests/unit/hooks/useWeeklySummary.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWeeklySummary } from "../../../src/hooks/useWeeklySummary";

describe("useWeeklySummary", () => {
  it("returns empty array for null rawData", () => {
    const { result } = renderHook(() => useWeeklySummary(null, [], []));
    expect(result.current).toEqual([]);
  });

  it("calculates correct average for single member", () => {
    const rawData = {
      "3/5": { "A": { total: 8, meeting: 2, dev: 6 } },
      "3/6": { "A": { total: 6, meeting: 1, dev: 5 } },
    };
    const { result } = renderHook(() =>
      useWeeklySummary(rawData, ["3/5", "3/6"], ["A"])
    );
    expect(result.current[0].avg).toBe(7);
    expect(result.current[0].sum).toBe(14);
    expect(result.current[0].daysReported).toBe(2);
  });

  it("calculates meeting percentage", () => {
    const rawData = {
      "3/5": { "A": { total: 10, meeting: 5, dev: 5 } },
    };
    const { result } = renderHook(() =>
      useWeeklySummary(rawData, ["3/5"], ["A"])
    );
    expect(result.current[0].meetPct).toBe(50);
  });

  it("sorts by avg descending", () => {
    const rawData = {
      "3/5": {
        "Low": { total: 4, meeting: 1, dev: 3 },
        "High": { total: 9, meeting: 2, dev: 7 },
      },
    };
    const { result } = renderHook(() =>
      useWeeklySummary(rawData, ["3/5"], ["Low", "High"])
    );
    expect(result.current[0].name).toBe("High");
    expect(result.current[1].name).toBe("Low");
  });

  it("calculates stability (stdDev)", () => {
    const rawData = {
      "3/5": { "A": { total: 8, meeting: 1, dev: 7 } },
      "3/6": { "A": { total: 8, meeting: 1, dev: 7 } },
    };
    const { result } = renderHook(() =>
      useWeeklySummary(rawData, ["3/5", "3/6"], ["A"])
    );
    expect(result.current[0].stdDev).toBe(0);
    expect(result.current[0].stabilityPct).toBe(100);
  });

  it("computes trend icon from first to last date", () => {
    const rawData = {
      "3/5": { "A": { total: 5, meeting: 1, dev: 4 } },
      "3/6": { "A": { total: 8, meeting: 2, dev: 6 } },
    };
    const { result } = renderHook(() =>
      useWeeklySummary(rawData, ["3/5", "3/6"], ["A"])
    );
    expect(result.current[0].trend).toBe("📈"); // increase > 1
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Create the hook (GREEN)**

```typescript
// src/hooks/useWeeklySummary.ts
import { useMemo } from "react";
import { COLORS } from "../constants";
import { getTrendIcon } from "../utils";

export function useWeeklySummary(
  rawData: Record<string, Record<string, any>> | null,
  dates: string[],
  members: string[]
) {
  return useMemo(() => {
    if (!rawData) return [];
    return members.map(m => {
      let totalSum = 0, meetSum = 0, devSum = 0, count = 0;
      const dailyTotals: number[] = [];
      for (const d of dates) {
        const entry = rawData[d]?.[m];
        if (entry?.total != null) { totalSum += entry.total; count++; dailyTotals.push(entry.total); }
        if (entry?.meeting != null) { meetSum += entry.meeting; }
        if (entry?.dev != null) { devSum += entry.dev; }
      }
      const avg = count ? +(totalSum / count).toFixed(1) : null;
      const sum = count ? +totalSum.toFixed(1) : null;
      const devAvg = count ? +(devSum / count).toFixed(1) : null;
      const meetAvg = count ? +(meetSum / count).toFixed(1) : null;
      const stdDev = dailyTotals.length >= 2 ? Math.sqrt(dailyTotals.reduce((s, v) => s + (v - avg!) * (v - avg!), 0) / dailyTotals.length) : null;
      const maxStdDev = 3;
      const stabilityPct = stdDev !== null ? Math.max(0, 100 - (stdDev / maxStdDev) * 100) : 0;
      const stabilityColor = stabilityPct >= 70 ? COLORS.green : stabilityPct >= 40 ? COLORS.yellow : COLORS.orange;
      const v1 = rawData[dates[0]]?.[m]?.total ?? null;
      const v2 = rawData[dates[dates.length - 1]]?.[m]?.total ?? null;
      return { name: m, avg, sum, devAvg, meetAvg, daysReported: count, meetSum: +meetSum.toFixed(1), meetPct: sum ? Math.round(meetSum / sum * 100) : 0, trend: getTrendIcon(v1, v2), stdDev, stabilityPct, stabilityColor };
    }).sort((a, b) => (b.avg || -1) - (a.avg || -1));
  }, [rawData, dates, members]);
}
```

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Replace in App.tsx and commit**

```bash
git add src/hooks/useWeeklySummary.ts tests/unit/hooks/useWeeklySummary.test.ts src/App.tsx
git commit -m "feat: extract useWeeklySummary hook with TDD tests"
```

### Task 8: useTrendData hook

**Files:**
- Create: `tests/unit/hooks/useTrendData.test.ts`
- Create: `src/hooks/useTrendData.ts`
- Modify: `src/App.tsx` (trendDates, trendData, useWeeklyAgg, weekGroups blocks)

- [ ] **Step 1: Write failing test (RED)**

```typescript
// tests/unit/hooks/useTrendData.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrendData } from "../../../src/hooks/useTrendData";

const dates5 = ["3/9", "3/10", "3/11", "3/12", "3/13"];
const dates12 = ["3/2", "3/3", "3/4", "3/5", "3/6", "3/9", "3/10", "3/11", "3/12", "3/13", "3/16", "3/17"];
const rawData: any = {};
dates12.forEach(d => { rawData[d] = { A: { total: 8, meeting: 2, dev: 6 } }; });
const dayLabels: any = {};
dates12.forEach(d => { dayLabels[d] = "一"; });

describe("useTrendData", () => {
  it("trendRange week returns last 5 dates", () => {
    const { result } = renderHook(() =>
      useTrendData(rawData, dates12, ["A"], dayLabels, null, "week")
    );
    expect(result.current.trendDates).toHaveLength(5);
    expect(result.current.useWeeklyAgg).toBe(false);
  });

  it("trendRange 2weeks returns last 10 dates", () => {
    const { result } = renderHook(() =>
      useTrendData(rawData, dates12, ["A"], dayLabels, null, "2weeks")
    );
    expect(result.current.trendDates).toHaveLength(10);
  });

  it("trendRange month enables weekly aggregation", () => {
    const { result } = renderHook(() =>
      useTrendData(rawData, dates12, ["A"], dayLabels, null, "month")
    );
    expect(result.current.useWeeklyAgg).toBe(true);
    expect(result.current.weekGroups.length).toBeGreaterThan(0);
  });

  it("trendData includes team average", () => {
    const { result } = renderHook(() =>
      useTrendData(rawData, dates5, ["A"], dayLabels, null, "week")
    );
    expect(result.current.trendData[0]).toHaveProperty("團隊平均");
    expect(result.current.trendData[0]["團隊平均"]).toBe(8);
  });

  it("returns empty trendData for null rawData", () => {
    const { result } = renderHook(() =>
      useTrendData(null, dates5, ["A"], dayLabels, null, "week")
    );
    expect(result.current.trendData).toEqual([]);
  });

  it("weekGroups have correct structure", () => {
    const { result } = renderHook(() =>
      useTrendData(rawData, dates12, ["A"], dayLabels, null, "month")
    );
    const group = result.current.weekGroups[0];
    expect(group).toHaveProperty("key");
    expect(group).toHaveProperty("label");
    expect(group).toHaveProperty("dates");
    expect(group.dates.length).toBeGreaterThan(0);
  });

  it("merges commit data into trend rows", () => {
    const commitData = {
      commits: { "3/9": { A: { count: 5, projects: [], items: [] } } },
      analysis: {},
      projectRisks: [],
    };
    const { result } = renderHook(() =>
      useTrendData(rawData, dates5, ["A"], dayLabels, commitData as any, "week")
    );
    expect(result.current.trendData[0]["_commit_A"]).toBe(5);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Create the hook (GREEN)**

Extract from App.tsx: `trendDates` useMemo (lines 106-110), `trendData` useMemo (lines 112-132), `useWeeklyAgg` const (line 134), `weekGroups` useMemo (lines 136-155). Bundle into a single `useTrendData` hook that returns all four values.

```typescript
// src/hooks/useTrendData.ts
import { useMemo } from "react";
import { getWeekRange } from "../utils";
import type { CommitData } from "../types";

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
): TrendDataResult {
  const trendDates = useMemo(() => {
    const limits: Record<string, number> = { week: 5, "2weeks": 10, month: 22, all: Infinity };
    const n = limits[trendRange] || Infinity;
    return n >= dates.length ? dates : dates.slice(-n);
  }, [dates, trendRange]);

  const trendData = useMemo(() => {
    if (!rawData) return [];
    return trendDates.map(date => {
      const row: any = { date: `${date}（${dayLabels[date]}）` };
      const vals: number[] = [];
      members.forEach(m => {
        const v = rawData[date]?.[m]?.total ?? null;
        row[m] = v;
        if (v !== null) vals.push(v);
      });
      row['團隊平均'] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
      row['_min'] = vals.length ? Math.min(...vals) : null;
      row['_max'] = vals.length ? Math.max(...vals) : null;
      if (commitData?.commits?.[date]) {
        for (const m of members) {
          row[`_commit_${m}`] = commitData.commits[date]?.[m]?.count || 0;
        }
      }
      return row;
    });
  }, [rawData, trendDates, members, dayLabels, commitData]);

  const useWeeklyAgg = trendRange === 'month' || trendRange === 'all';

  const weekGroups = useMemo(() => {
    if (!useWeeklyAgg || !trendDates.length) return [];
    const year = new Date().getFullYear();
    const groups: any[] = [];
    let current: any = null;
    for (const d of trendDates) {
      const [m, dd] = d.split('/').map(Number);
      const date = new Date(year, m - 1, dd);
      const { monday } = getWeekRange(date);
      const wk = `${monday.getMonth()+1}/${monday.getDate()}`;
      if (!current || current.key !== wk) {
        const fri = new Date(monday);
        fri.setDate(monday.getDate() + 4);
        current = { key: wk, label: `${wk}–${fri.getMonth()+1}/${fri.getDate()}`, dates: [] };
        groups.push(current);
      }
      current.dates.push(d);
    }
    return groups;
  }, [trendDates, useWeeklyAgg]);

  return { trendDates, trendData, useWeeklyAgg, weekGroups };
}
```

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Replace in App.tsx**

Replace all four blocks (trendDates, trendData, useWeeklyAgg, weekGroups) with:
```typescript
  const { trendDates, trendData, useWeeklyAgg, weekGroups } = useTrendData(rawData, dates, members, dayLabels, commitData, trendRange);
```

- [ ] **Step 6: Run full suite, commit**

```bash
git add src/hooks/useTrendData.ts tests/unit/hooks/useTrendData.test.ts src/App.tsx
git commit -m "feat: extract useTrendData hook with TDD tests"
```

---

## Chunk 3: Component Tests + View Extraction (TDD Red-Green)

### Task 9: Test existing components (green start)

**Files:**
- Create: `tests/components/components.test.tsx`

- [ ] **Step 1: Write component tests**

```tsx
// tests/components/components.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardPanel, ColorDot, StatusBadge } from "../../src/components";

describe("CardPanel", () => {
  it("renders title and children", () => {
    render(<CardPanel title="Test Title"><p>Content</p></CardPanel>);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });
});

describe("ColorDot", () => {
  it("renders with given color", () => {
    const { container } = render(<ColorDot color="#ff0000" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toBe("rgb(255, 0, 0)");
  });
});

describe("StatusBadge", () => {
  it("renders label with correct colors", () => {
    render(<StatusBadge status={{ label: "合理", color: "#22c55e", bg: "#166534" }} />);
    expect(screen.getByText("合理")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — expected PASS**

```bash
bun test tests/components/components.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add tests/components/components.test.tsx
git commit -m "test: add component tests for CardPanel, ColorDot, StatusBadge"
```

### Task 10: Extract StatusOverview (TDD)

**Files:**
- Create: `tests/components/StatusOverview.test.tsx`
- Create: `src/views/StatusOverview.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing test (RED)**

```tsx
// tests/components/StatusOverview.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { StatusOverview } from "../../src/views/StatusOverview";

const baseProps = {
  allIssues: [],
  issues: [],
  members: ["A", "B"],
  rawData: { "3/5": { A: { total: 8 }, B: { total: 7 } } },
  dates: ["3/5"],
};

describe("StatusOverview", () => {
  it("shows 全員狀態正常 when no issues", () => {
    render(<StatusOverview {...baseProps} />);
    expect(screen.getByText("全員狀態正常")).toBeInTheDocument();
  });

  it("shows reporting rate", () => {
    render(<StatusOverview {...baseProps} />);
    expect(screen.getByText("2")).toBeInTheDocument(); // reportedCount
    expect(screen.getByText(/\/2/)).toBeInTheDocument(); // /total
  });

  it("shows attention count with issues", () => {
    const props = {
      ...baseProps,
      allIssues: [{ member: "A", severity: "🔴", text: "超時" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("1")).toBeInTheDocument(); // attention count
  });

  it("renders attention card with member name and text", () => {
    const props = {
      ...baseProps,
      allIssues: [{ member: "A", severity: "🔴", text: "超時" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("超時")).toBeInTheDocument();
  });

  it("renders team average", () => {
    render(<StatusOverview {...baseProps} />);
    expect(screen.getByText("7.5")).toBeInTheDocument(); // (8+7)/2
  });

  it("renders stable members section when green issues exist", () => {
    const props = {
      ...baseProps,
      issues: [{ member: "B", severity: "🟢", text: "穩定" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("穩定")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Extract StatusOverview from App.tsx (GREEN)**

Create `src/views/StatusOverview.tsx` by extracting the Team Status Overview IIFE from App.tsx (lines 231-326). Export as a named component. Compute `reportedCount`, `teamAvg`, `attentionIssues`, `stableIssues` inside the component from props.

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Replace in App.tsx, run full suite, commit**

```bash
git add src/views/StatusOverview.tsx tests/components/StatusOverview.test.tsx src/App.tsx
git commit -m "feat: extract StatusOverview component with TDD tests"
```

### Task 11: Extract DailyView (TDD)

**Files:**
- Create: `tests/components/DailyView.test.tsx`
- Create: `src/views/DailyView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing test (RED)**

```tsx
// tests/components/DailyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { DailyView } from "../../src/views/DailyView";

const baseProps = {
  dailyDates: ["3/9", "3/10"],
  activeDate: "3/10",
  onDateSelect: vi.fn(),
  dayLabels: { "3/9": "一", "3/10": "二" },
  weekLabel: "本週 3/9 – 3/13",
  dailyBarData: [
    { name: "Alice", 開發: 6, 會議: 2, total: 8 },
    { name: "Bob", 開發: 5, 會議: 1, total: 6 },
  ],
  chartHeight: 380,
  memberColors: { Alice: "#f472b6", Bob: "#a78bfa" },
  issueMap: {},
  commitData: null,
  leave: {},
};

describe("DailyView", () => {
  it("renders date buttons", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText(/3\/9/)).toBeInTheDocument();
    expect(screen.getByText(/3\/10/)).toBeInTheDocument();
  });

  it("renders member cards", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows week label", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("本週 3/9 – 3/13")).toBeInTheDocument();
  });

  it("active date button has accent border", () => {
    const { container } = render(<DailyView {...baseProps} />);
    const buttons = container.querySelectorAll(".date-btn");
    const activeBtn = Array.from(buttons).find(b => b.textContent?.includes("3/10"));
    expect(activeBtn).toBeDefined();
    expect((activeBtn as HTMLElement).style.border).toContain("3b82f6"); // COLORS.accent
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Extract DailyView from App.tsx (GREEN)**

Create `src/views/DailyView.tsx` by extracting the `view === "daily"` block from App.tsx. The component receives all needed data as props — no hooks inside except local state if needed.

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Replace in App.tsx, run full suite, commit**

```bash
git add src/views/DailyView.tsx tests/components/DailyView.test.tsx src/App.tsx
git commit -m "feat: extract DailyView component with TDD tests"
```

### Task 12: Extract TrendView (TDD)

**Files:**
- Create: `tests/components/TrendView.test.tsx`
- Create: `src/views/TrendView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing test (RED)**

```tsx
// tests/components/TrendView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { TrendView } from "../../src/views/TrendView";

const baseProps = {
  trendRange: "2weeks",
  onTrendRangeChange: vi.fn(),
  trendDates: ["3/9", "3/10"],
  trendData: [{ date: "3/9（一）", A: 8, "團隊平均": 8 }],
  useWeeklyAgg: false,
  weekGroups: [],
  members: ["A"],
  memberColors: { A: "#f472b6" },
  selectedMembers: new Set<string>(),
  onToggleMember: vi.fn(),
  onClearMembers: vi.fn(),
  isMobile: false,
  commitData: null,
  rawData: { "3/9": { A: { total: 8 } } },
  leave: {},
};

describe("TrendView", () => {
  it("renders time range buttons", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText("1週")).toBeInTheDocument();
    expect(screen.getByText("2週")).toBeInTheDocument();
    expect(screen.getByText("1月")).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
  });

  it("renders member chips", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows clear button when members selected", () => {
    const props = { ...baseProps, selectedMembers: new Set(["A"]) };
    render(<TrendView {...props} />);
    expect(screen.getByText("清除")).toBeInTheDocument();
  });

  it("renders daily table when useWeeklyAgg is false", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText("成員")).toBeInTheDocument();
    expect(screen.getByText("平均")).toBeInTheDocument();
    expect(screen.getByText("穩定度")).toBeInTheDocument();
  });

  it("renders weekly table when useWeeklyAgg is true", () => {
    const props = {
      ...baseProps,
      useWeeklyAgg: true,
      weekGroups: [{ key: "3/9", label: "3/9–3/13", dates: ["3/9", "3/10"] }],
    };
    render(<TrendView {...props} />);
    expect(screen.getByText("3/9–3/13")).toBeInTheDocument();
  });

  it("renders date range info", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText(/3\/9.*3\/10/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
bun test tests/components/TrendView.test.tsx
```

- [ ] **Step 3: Extract TrendView from App.tsx (GREEN)**

Create `src/views/TrendView.tsx` by extracting the `view === "trend"` block from App.tsx (lines 435-714). Export as a named component. The component receives all data as props — the chart rendering, time range selector, member chips, and the daily/weekly table all move here.

- [ ] **Step 4: Run test — expected PASS**

```bash
bun test tests/components/TrendView.test.tsx
```

- [ ] **Step 5: Replace in App.tsx, run full suite, commit**

```bash
bun test
git add src/views/TrendView.tsx tests/components/TrendView.test.tsx src/App.tsx
git commit -m "feat: extract TrendView component with TDD tests"
```

### Task 13: Extract WeeklyView (TDD)

**Files:**
- Create: `tests/components/WeeklyView.test.tsx`
- Create: `src/views/WeeklyView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing test (RED)**

```tsx
// tests/components/WeeklyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { WeeklyView } from "../../src/views/WeeklyView";

const baseProps = {
  weeklySummary: [
    { name: "A", avg: 8, sum: 40, devAvg: 6, meetAvg: 2, daysReported: 5, meetSum: 10, meetPct: 25, trend: "➡️", stdDev: 0.5, stabilityPct: 83, stabilityColor: "#22c55e" },
  ],
  chartHeight: 380,
  members: ["A"],
  memberColors: { A: "#f472b6" },
  selectedMembers: new Set<string>(),
  onToggleMember: vi.fn(),
  isMobile: false,
  dates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
};

describe("WeeklyView", () => {
  it("renders table headers", () => {
    render(<WeeklyView {...baseProps} />);
    expect(screen.getByText("成員")).toBeInTheDocument();
    expect(screen.getByText("回報")).toBeInTheDocument();
    expect(screen.getByText("日均")).toBeInTheDocument();
  });

  it("renders member stats", () => {
    render(<WeeklyView {...baseProps} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument(); // daysReported/total
  });

  it("shows meeting warning when meetPct > 50", () => {
    const props = {
      ...baseProps,
      weeklySummary: [
        { ...baseProps.weeklySummary[0], meetPct: 60 },
      ],
    };
    render(<WeeklyView {...props} />);
    expect(screen.getByText(/60%.*⚠/)).toBeInTheDocument();
  });

  it("renders stability bar", () => {
    const { container } = render(<WeeklyView {...baseProps} />);
    // stabilityColor is green (#22c55e), should be visible
    const stabilityText = screen.getByText("0.5"); // stdDev value
    expect(stabilityText).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
bun test tests/components/WeeklyView.test.tsx
```

- [ ] **Step 3: Extract WeeklyView from App.tsx (GREEN)**

Create `src/views/WeeklyView.tsx` by extracting the `view === "weekly"` block from App.tsx (lines 716-814). Export as a named component. Includes the bar chart and stats table.

- [ ] **Step 4: Run test — expected PASS**

```bash
bun test tests/components/WeeklyView.test.tsx
```

- [ ] **Step 5: Replace in App.tsx, run full suite, commit**

```bash
bun test
git add src/views/WeeklyView.tsx tests/components/WeeklyView.test.tsx src/App.tsx
git commit -m "feat: extract WeeklyView component with TDD tests"
```

---

## Chunk 4: Final Verification

### Task 14: Final verification and cleanup

- [ ] **Step 1: Verify App.tsx size**

```bash
wc -l src/App.tsx
```

Expected: ~120-150 lines.

- [ ] **Step 2: Run full test suite**

```bash
bun test
```

Expected: All tests pass (existing 48 + new ~60+ tests).

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Build check**

```bash
bun run build
```

Expected: Build succeeds.

- [ ] **Step 5: Dev server visual check**

```bash
bun run dev
```

Verify all 4 tabs render identically to pre-refactor at http://localhost:5173.

- [ ] **Step 6: Check test-to-code ratio**

```bash
wc -l tests/unit/**/*.ts tests/components/**/*.tsx
wc -l src/**/*.tsx src/**/*.ts
```

Expected: Test-to-frontend-code ratio >= 0.5:1.

- [ ] **Step 7: Commit if any final fixes needed**

```bash
git status
git add <specific-files>
git commit -m "fix: address issues found during final verification"
```
