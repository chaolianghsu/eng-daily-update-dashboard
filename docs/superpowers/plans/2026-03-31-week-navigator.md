# Week Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add week navigation to DailyView so users can switch between this week, last week, and earlier weeks with data.

**Architecture:** Replace `useCurrentWeek` hook with `useWeekNavigator` that groups all dates into weeks and provides navigation state/callbacks. DailyView gets a new navigator bar with ◀ ▶ arrows, a clickable week label with dropdown, and 本週/上週 quick-jump pills.

**Tech Stack:** React 18, TypeScript, Vitest, existing `getWeekRange` utility

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hooks/useWeekNavigator.ts` | Create | Week grouping, navigation state, callbacks |
| `src/hooks/useCurrentWeek.ts` | Delete | Replaced by useWeekNavigator |
| `src/views/DailyView.tsx` | Modify | Add navigator bar UI (arrows, label, dropdown, pills) |
| `src/App.tsx` | Modify | Switch hook, pass new props |
| `tests/unit/hooks/useWeekNavigator.test.ts` | Create | Unit tests for hook |
| `tests/unit/hooks/useCurrentWeek.test.ts` | Delete | Replaced |
| `tests/components/DailyView.test.tsx` | Modify | Update props, add navigator tests |

---

### Task 1: useWeekNavigator hook — RED (week grouping)

**Files:**
- Create: `tests/unit/hooks/useWeekNavigator.test.ts`
- Create: `src/hooks/useWeekNavigator.ts` (stub)

- [ ] **Step 1: Write failing tests for week grouping**

```typescript
// tests/unit/hooks/useWeekNavigator.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWeekNavigator } from "../../../src/hooks/useWeekNavigator";

describe("useWeekNavigator", () => {
  describe("week grouping", () => {
    it("returns empty state for no dates", () => {
      const { result } = renderHook(() => useWeekNavigator([]));
      expect(result.current.weeks).toEqual([]);
      expect(result.current.currentWeek).toEqual({ dates: [], label: "" });
      expect(result.current.canGoPrev).toBe(false);
      expect(result.current.canGoNext).toBe(false);
    });

    it("groups dates into weeks by Mon-Fri", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13)); // Fri March 13

      const dates = ["3/9", "3/10", "3/11", "3/12", "3/13"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weeks).toHaveLength(1);
      expect(result.current.weeks[0].dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);
      expect(result.current.currentWeek.dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);

      vi.useRealTimers();
    });

    it("groups dates spanning multiple weeks", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13)); // Fri March 13

      const dates = ["3/2", "3/3", "3/4", "3/9", "3/10", "3/11", "3/12", "3/13"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weeks).toHaveLength(2);
      expect(result.current.weeks[0].dates).toEqual(["3/2", "3/3", "3/4"]);
      expect(result.current.weeks[1].dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);

      vi.useRealTimers();
    });

    it("defaults to latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weekIndex).toBe(1); // latest
      expect(result.current.currentWeek.dates).toEqual(["3/9", "3/10"]);

      vi.useRealTimers();
    });

    it("generates week labels with date range", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/9", "3/10", "3/11"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.currentWeek.label).toContain("3/9");
      expect(result.current.currentWeek.label).toContain("3/13");

      vi.useRealTimers();
    });
  });
});
```

- [ ] **Step 2: Create stub hook to verify tests fail**

```typescript
// src/hooks/useWeekNavigator.ts
import { useMemo, useState } from "react";

export function useWeekNavigator(_dates: string[]) {
  return {
    weeks: [] as Array<{ dates: string[]; label: string }>,
    weekIndex: 0,
    currentWeek: { dates: [] as string[], label: "" },
    canGoPrev: false,
    canGoNext: false,
    isThisWeek: false,
    isLastWeek: false,
    goToPrev: () => {},
    goToNext: () => {},
    goToWeek: (_index: number) => {},
    goToThisWeek: () => {},
    goToLastWeek: () => {},
  };
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test tests/unit/hooks/useWeekNavigator.test.ts`
Expected: 4 FAIL (grouping, multi-week, defaults, labels), 1 PASS (empty)

---

### Task 2: useWeekNavigator hook — GREEN (week grouping)

**Files:**
- Modify: `src/hooks/useWeekNavigator.ts`

- [ ] **Step 1: Implement week grouping logic**

```typescript
// src/hooks/useWeekNavigator.ts
import { useMemo, useState, useCallback } from "react";
import { getWeekRange } from "../utils";

interface Week {
  dates: string[];
  monday: Date;
  friday: Date;
  label: string;
}

export function useWeekNavigator(dates: string[]) {
  const weeks: Week[] = useMemo(() => {
    if (!dates.length) return [];
    const year = new Date().getFullYear();
    const weekMap = new Map<string, { monday: Date; friday: Date; dates: string[] }>();

    for (const d of dates) {
      const [m, dd] = d.split("/").map(Number);
      const date = new Date(year, m - 1, dd);
      const { monday, friday } = getWeekRange(date);
      const key = `${monday.getMonth() + 1}/${monday.getDate()}`;
      if (!weekMap.has(key)) {
        weekMap.set(key, { monday, friday, dates: [] });
      }
      weekMap.get(key)!.dates.push(d);
    }

    const fmtDate = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
    return Array.from(weekMap.values())
      .sort((a, b) => a.monday.getTime() - b.monday.getTime())
      .map(w => ({
        dates: w.dates,
        monday: w.monday,
        friday: w.friday,
        label: `${fmtDate(w.monday)} – ${fmtDate(w.friday)}`,
      }));
  }, [dates]);

  const [weekIndex, setWeekIndex] = useState(() => Math.max(0, weeks.length - 1));

  const safeIndex = weeks.length === 0 ? -1 : Math.min(weekIndex, weeks.length - 1);
  const currentWeek = safeIndex >= 0 ? weeks[safeIndex] : { dates: [] as string[], label: "", monday: new Date(), friday: new Date() };
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < weeks.length - 1;
  const isThisWeek = safeIndex === weeks.length - 1;
  const isLastWeek = safeIndex === weeks.length - 2;

  const goToPrev = useCallback(() => { if (canGoPrev) setWeekIndex(i => i - 1); }, [canGoPrev]);
  const goToNext = useCallback(() => { if (canGoNext) setWeekIndex(i => i + 1); }, [canGoNext]);
  const goToWeek = useCallback((index: number) => {
    if (index >= 0 && index < weeks.length) setWeekIndex(index);
  }, [weeks.length]);
  const goToThisWeek = useCallback(() => setWeekIndex(weeks.length - 1), [weeks.length]);
  const goToLastWeek = useCallback(() => {
    if (weeks.length >= 2) setWeekIndex(weeks.length - 2);
  }, [weeks.length]);

  return {
    weeks: weeks.map(w => ({ dates: w.dates, label: w.label })),
    weekIndex: safeIndex,
    currentWeek: { dates: currentWeek.dates, label: currentWeek.label },
    canGoPrev,
    canGoNext,
    isThisWeek,
    isLastWeek,
    goToPrev,
    goToNext,
    goToWeek,
    goToThisWeek,
    goToLastWeek,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun run test tests/unit/hooks/useWeekNavigator.test.ts`
Expected: 5 PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWeekNavigator.ts tests/unit/hooks/useWeekNavigator.test.ts
git commit -m "feat: add useWeekNavigator hook with week grouping (TDD)"
```

---

### Task 3: useWeekNavigator hook — RED/GREEN (navigation)

**Files:**
- Modify: `tests/unit/hooks/useWeekNavigator.test.ts`

- [ ] **Step 1: Add navigation tests**

Append to `tests/unit/hooks/useWeekNavigator.test.ts` inside the outer `describe`:

```typescript
  describe("navigation", () => {
    it("goToPrev moves to earlier week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weekIndex).toBe(1);
      act(() => result.current.goToPrev());
      expect(result.current.weekIndex).toBe(0);
      expect(result.current.currentWeek.dates).toEqual(["3/2", "3/3"]);

      vi.useRealTimers();
    });

    it("goToNext moves to later week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToPrev());
      expect(result.current.weekIndex).toBe(0);
      act(() => result.current.goToNext());
      expect(result.current.weekIndex).toBe(1);

      vi.useRealTimers();
    });

    it("canGoPrev is false at earliest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToPrev());
      expect(result.current.canGoPrev).toBe(false);
      act(() => result.current.goToPrev()); // no-op
      expect(result.current.weekIndex).toBe(0);

      vi.useRealTimers();
    });

    it("canGoNext is false at latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.canGoNext).toBe(false);

      vi.useRealTimers();
    });

    it("goToWeek jumps to specific week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20));

      const dates = ["3/2", "3/3", "3/9", "3/10", "3/16", "3/17"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToWeek(0));
      expect(result.current.currentWeek.dates).toEqual(["3/2", "3/3"]);

      vi.useRealTimers();
    });

    it("goToThisWeek jumps to latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20));

      const dates = ["3/2", "3/3", "3/9", "3/10", "3/16", "3/17"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToWeek(0));
      act(() => result.current.goToThisWeek());
      expect(result.current.weekIndex).toBe(2);
      expect(result.current.isThisWeek).toBe(true);

      vi.useRealTimers();
    });

    it("goToLastWeek jumps to second-latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20));

      const dates = ["3/2", "3/3", "3/9", "3/10", "3/16", "3/17"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToLastWeek());
      expect(result.current.weekIndex).toBe(1);
      expect(result.current.isLastWeek).toBe(true);

      vi.useRealTimers();
    });

    it("goToLastWeek is no-op when only one week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToLastWeek());
      expect(result.current.weekIndex).toBe(0); // stays at latest (only) week

      vi.useRealTimers();
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun run test tests/unit/hooks/useWeekNavigator.test.ts`
Expected: 13 PASS (5 grouping + 8 navigation)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/hooks/useWeekNavigator.test.ts
git commit -m "test: add navigation tests for useWeekNavigator"
```

---

### Task 4: Wire up App.tsx — swap hook

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/hooks/useCurrentWeek.ts`
- Delete: `tests/unit/hooks/useCurrentWeek.test.ts`

- [ ] **Step 1: Replace useCurrentWeek with useWeekNavigator in App.tsx**

In `src/App.tsx`, replace the import:

```typescript
// Old:
import { useCurrentWeek } from "./hooks/useCurrentWeek";
// New:
import { useWeekNavigator } from "./hooks/useWeekNavigator";
```

Replace the hook call and derived state (around lines 67-71):

```typescript
// Old:
  const currentWeek = useCurrentWeek(dates);
  const dailyDates = currentWeek.dates;
  const activeDate = (selectedDate && dailyDates.includes(selectedDate))
    ? selectedDate
    : dailyDates[dailyDates.length - 1] || dates[dates.length - 1];

// New:
  const weekNav = useWeekNavigator(dates);
  const dailyDates = weekNav.currentWeek.dates;
  const activeDate = (selectedDate && dailyDates.includes(selectedDate))
    ? selectedDate
    : dailyDates[dailyDates.length - 1] || dates[dates.length - 1];
```

Update the DailyView render (around line 144):

```tsx
// Old:
          <DailyView dailyDates={dailyDates} activeDate={activeDate} onDateSelect={setSelectedDate}
            dayLabels={dayLabels} weekLabel={currentWeek.label} dailyBarData={dailyBarData}
            chartHeight={chartHeight} memberColors={memberColors} issueMap={issueMap}
            commitData={commitData} leave={leave} />

// New:
          <DailyView dailyDates={dailyDates} activeDate={activeDate} onDateSelect={setSelectedDate}
            dayLabels={dayLabels} dailyBarData={dailyBarData}
            chartHeight={chartHeight} memberColors={memberColors} issueMap={issueMap}
            commitData={commitData} leave={leave}
            weeks={weekNav.weeks} weekIndex={weekNav.weekIndex}
            canGoPrev={weekNav.canGoPrev} canGoNext={weekNav.canGoNext}
            isThisWeek={weekNav.isThisWeek} isLastWeek={weekNav.isLastWeek}
            onPrevWeek={weekNav.goToPrev} onNextWeek={weekNav.goToNext}
            onThisWeek={weekNav.goToThisWeek} onLastWeek={weekNav.goToLastWeek}
            onSelectWeek={weekNav.goToWeek} />
```

- [ ] **Step 2: Delete old files**

```bash
rm src/hooks/useCurrentWeek.ts tests/unit/hooks/useCurrentWeek.test.ts
```

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: DailyView tests will fail (props changed). Hook tests pass. This is expected — Task 5 fixes DailyView.

- [ ] **Step 4: Commit (WIP)**

```bash
git add -A
git commit -m "refactor: swap useCurrentWeek for useWeekNavigator in App.tsx"
```

---

### Task 5: DailyView — add week navigator UI

**Files:**
- Modify: `src/views/DailyView.tsx`
- Modify: `tests/components/DailyView.test.tsx`

- [ ] **Step 1: Update DailyView props interface**

In `src/views/DailyView.tsx`, replace the `DailyViewProps` interface (lines 11-23):

```typescript
interface DailyViewProps {
  dailyDates: string[];
  activeDate: string;
  onDateSelect: (date: string) => void;
  dayLabels: Record<string, string>;
  dailyBarData: Array<{ name: string; 開發: number; 會議: number; total: number | null; status?: string }>;
  chartHeight: number;
  memberColors: Record<string, string>;
  issueMap: Record<string, { severity: string; text: string }>;
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
  weeks: Array<{ dates: string[]; label: string }>;
  weekIndex: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  isThisWeek: boolean;
  isLastWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onLastWeek: () => void;
  onSelectWeek: (index: number) => void;
}
```

- [ ] **Step 2: Update destructured props and add dropdown state**

Add `useState, useRef, useEffect` import at the top of the file:

```typescript
import { useState, useRef, useEffect } from "react";
```

Replace the function signature and add dropdown state:

```typescript
export function DailyView({
  dailyDates, activeDate, onDateSelect, dayLabels,
  dailyBarData, chartHeight, memberColors, issueMap, commitData, leave,
  weeks, weekIndex, canGoPrev, canGoNext, isThisWeek, isLastWeek,
  onPrevWeek, onNextWeek, onThisWeek, onLastWeek, onSelectWeek,
}: DailyViewProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);
```

- [ ] **Step 3: Replace week label section with navigator bar**

Replace the first `<div className="animate-in">` block (the one containing `week-label` and `date-scroll`, lines 31-48) with:

```tsx
      <div className="animate-in" style={{ animationDelay: "0.15s", marginBottom: 20 }}>
        {/* Week Navigator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={onPrevWeek} disabled={!canGoPrev}
              style={{
                background: "none", border: "none", cursor: canGoPrev ? "pointer" : "default",
                color: canGoPrev ? COLORS.textDim : COLORS.border, fontSize: 16, padding: "4px 6px",
                fontFamily: "inherit", transition: "color 0.15s",
              }}
              onMouseEnter={e => { if (canGoPrev) (e.target as HTMLElement).style.color = COLORS.text; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = canGoPrev ? COLORS.textDim : COLORS.border; }}
            >◀</button>

            <div ref={dropdownRef} style={{ position: "relative" }}>
              <button onClick={() => setDropdownOpen(o => !o)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: COLORS.text, fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                  padding: "4px 8px", borderRadius: 6,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = COLORS.card; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = "none"; }}
              >
                {isThisWeek ? "本週 " : ""}{weeks[weekIndex]?.label || ""} ▾
              </button>

              {dropdownOpen && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50,
                  background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
                  padding: 4, minWidth: 180, maxHeight: 240, overflowY: "auto",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                }}>
                  {weeks.map((w, i) => (
                    <button key={i} onClick={() => { onSelectWeek(i); setDropdownOpen(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                        background: i === weekIndex ? "rgba(59,130,246,0.1)" : "transparent",
                        border: "none", borderRadius: 6, cursor: "pointer",
                        borderLeft: i === weekIndex ? `3px solid ${COLORS.accent}` : "3px solid transparent",
                        color: i === weekIndex ? COLORS.accentLight : COLORS.textMuted,
                        fontSize: 12, fontWeight: i === weekIndex ? 700 : 500, fontFamily: "inherit",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { if (i !== weekIndex) (e.target as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={e => { if (i !== weekIndex) (e.target as HTMLElement).style.background = "transparent"; }}
                    >{w.label}</button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={onNextWeek} disabled={!canGoNext}
              style={{
                background: "none", border: "none", cursor: canGoNext ? "pointer" : "default",
                color: canGoNext ? COLORS.textDim : COLORS.border, fontSize: 16, padding: "4px 6px",
                fontFamily: "inherit", transition: "color 0.15s",
              }}
              onMouseEnter={e => { if (canGoNext) (e.target as HTMLElement).style.color = COLORS.text; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = canGoNext ? COLORS.textDim : COLORS.border; }}
            >▶</button>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={onThisWeek}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                border: isThisWeek ? `1px solid ${COLORS.accent}44` : `1px solid ${COLORS.border}`,
                background: isThisWeek ? "rgba(59,130,246,0.15)" : "transparent",
                color: isThisWeek ? COLORS.accentLight : COLORS.textDim,
                cursor: "pointer", transition: "all 0.15s",
              }}
            >本週</button>
            <button onClick={onLastWeek} disabled={weeks.length < 2}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                border: isLastWeek ? `1px solid ${COLORS.accent}44` : `1px solid ${COLORS.border}`,
                background: isLastWeek ? "rgba(59,130,246,0.15)" : "transparent",
                color: weeks.length < 2 ? COLORS.border : (isLastWeek ? COLORS.accentLight : COLORS.textDim),
                cursor: weeks.length < 2 ? "default" : "pointer",
                opacity: weeks.length < 2 ? 0.4 : 1,
                transition: "all 0.15s",
              }}
            >上週</button>
          </div>
        </div>

        {/* Date buttons */}
        <div className="date-scroll">
          {dailyDates.map(d => (
            <button key={d} className="date-btn" onClick={() => onDateSelect(d)}
              style={{
                padding: "8px 20px", borderRadius: 8, cursor: "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                border: activeDate === d ? `2px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                background: activeDate === d ? "rgba(59,130,246,0.15)" : "transparent",
                color: activeDate === d ? COLORS.accentLight : COLORS.textMuted,
              }}
            >{d}（{dayLabels[d]}）</button>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Update DailyView tests**

Replace `tests/components/DailyView.test.tsx`:

```typescript
// tests/components/DailyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { DailyView } from "../../src/views/DailyView";

const baseProps = {
  dailyDates: ["3/9", "3/10"],
  activeDate: "3/10",
  onDateSelect: vi.fn(),
  dayLabels: { "3/9": "一", "3/10": "二" },
  dailyBarData: [
    { name: "Alice", 開發: 6, 會議: 2, total: 8 },
    { name: "Bob", 開發: 5, 會議: 1, total: 6 },
  ],
  chartHeight: 380,
  memberColors: { Alice: "#f472b6", Bob: "#a78bfa" },
  issueMap: {},
  commitData: null,
  leave: {},
  weeks: [
    { dates: ["3/2", "3/3", "3/4"], label: "3/2 – 3/6" },
    { dates: ["3/9", "3/10"], label: "3/9 – 3/13" },
  ],
  weekIndex: 1,
  canGoPrev: true,
  canGoNext: false,
  isThisWeek: true,
  isLastWeek: false,
  onPrevWeek: vi.fn(),
  onNextWeek: vi.fn(),
  onThisWeek: vi.fn(),
  onLastWeek: vi.fn(),
  onSelectWeek: vi.fn(),
};

describe("DailyView", () => {
  it("renders date buttons", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getAllByText(/3\/9/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/3\/10/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders member cards", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows week label with range", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText(/3\/9 – 3\/13/)).toBeInTheDocument();
  });

  it("active date button has accent border", () => {
    const { container } = render(<DailyView {...baseProps} />);
    const buttons = container.querySelectorAll(".date-btn");
    const activeBtn = Array.from(buttons).find(b => b.textContent?.includes("3/10"));
    expect(activeBtn).toBeDefined();
    expect((activeBtn as HTMLElement).style.border).toContain("59, 130, 246");
  });

  it("shows '未報' for unreported members", () => {
    const props = {
      ...baseProps,
      dailyBarData: [
        { name: "A", 開發: null, 會議: null, total: null, status: 'unreported' as const },
      ],
    };
    render(<DailyView {...props} />);
    expect(screen.getByText("未報")).toBeInTheDocument();
  });

  it("shows '無工時' for replied_no_hours members", () => {
    const props = {
      ...baseProps,
      dailyBarData: [
        { name: "A", 開發: null, 會議: null, total: null, status: 'replied_no_hours' as const },
      ],
    };
    render(<DailyView {...props} />);
    expect(screen.getByText("無工時")).toBeInTheDocument();
  });

  it("renders 本週 and 上週 pills", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("本週")).toBeInTheDocument();
    expect(screen.getByText("上週")).toBeInTheDocument();
  });

  it("renders ◀ and ▶ arrows", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("◀")).toBeInTheDocument();
    expect(screen.getByText("▶")).toBeInTheDocument();
  });

  it("disables ▶ when canGoNext is false", () => {
    render(<DailyView {...baseProps} />);
    const nextBtn = screen.getByText("▶");
    expect(nextBtn).toBeDisabled();
  });

  it("calls onPrevWeek when ◀ clicked", () => {
    render(<DailyView {...baseProps} />);
    fireEvent.click(screen.getByText("◀"));
    expect(baseProps.onPrevWeek).toHaveBeenCalled();
  });

  it("opens dropdown when week label clicked", () => {
    render(<DailyView {...baseProps} />);
    const label = screen.getByText(/3\/9 – 3\/13/);
    fireEvent.click(label);
    // Dropdown shows all weeks
    expect(screen.getByText("3/2 – 3/6")).toBeInTheDocument();
  });

  it("calls onSelectWeek when dropdown item clicked", () => {
    render(<DailyView {...baseProps} />);
    fireEvent.click(screen.getByText(/3\/9 – 3\/13/));
    fireEvent.click(screen.getByText("3/2 – 3/6"));
    expect(baseProps.onSelectWeek).toHaveBeenCalledWith(0);
  });

  it("disables 上週 pill when only one week", () => {
    const props = {
      ...baseProps,
      weeks: [{ dates: ["3/9", "3/10"], label: "3/9 – 3/13" }],
      weekIndex: 0,
      canGoPrev: false,
    };
    render(<DailyView {...props} />);
    const lastWeekBtn = screen.getByText("上週");
    expect(lastWeekBtn).toBeDisabled();
  });
});
```

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/views/DailyView.tsx tests/components/DailyView.test.tsx
git commit -m "feat: add week navigator UI to DailyView"
```

---

### Task 6: Update CLAUDE.md and cleanup

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update hook reference in CLAUDE.md**

In `CLAUDE.md`, find the line:
```
  - `hooks/` — Custom hooks: `useCurrentWeek`, `useDailyBarData`, `useTrendData`, `useWeeklySummary`, `useAllIssues`
```

Replace with:
```
  - `hooks/` — Custom hooks: `useWeekNavigator`, `useDailyBarData`, `useTrendData`, `useWeeklySummary`, `useAllIssues`
```

- [ ] **Step 2: Run full test suite to confirm everything passes**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md hook reference to useWeekNavigator"
```

---

### Task 7: Playwright E2E smoke test

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Read existing smoke test**

Read `tests/e2e/smoke.spec.ts` to understand the pattern.

- [ ] **Step 2: Add week navigator E2E test**

Append a test to the existing smoke spec:

```typescript
test('week navigator arrows and pills visible', async ({ page }) => {
  await page.goto('/');
  // Wait for dashboard to load
  await page.waitForSelector('.date-btn');

  // Arrows should be visible
  await expect(page.getByText('◀')).toBeVisible();
  await expect(page.getByText('▶')).toBeVisible();

  // Pills should be visible
  await expect(page.getByText('本週')).toBeVisible();
  await expect(page.getByText('上週')).toBeVisible();
});

test('week navigator dropdown opens on label click', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.date-btn');

  // Click the week label (contains ▾)
  await page.getByText(/▾/).click();

  // Dropdown should show at least one week option
  const options = page.locator('[style*="position: absolute"]').locator('button');
  await expect(options.first()).toBeVisible();
});
```

- [ ] **Step 3: Run E2E tests**

Run: `bunx playwright test tests/e2e/smoke.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test: add E2E smoke tests for week navigator"
```
