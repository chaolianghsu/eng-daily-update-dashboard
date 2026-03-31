# Tab Restructure + Shared Date Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure dashboard from 5 tabs to 3, extract shared DateNavigator/SubViewPills/PillGroup components, and unify visual style.

**Architecture:** Extract date navigation UI from DailyView and CommitsView into a shared `<DateNavigator>` component rendered by App.tsx. Merge Commits and PlanSpec tabs as sub-views under a new "每日詳情" tab with `<SubViewPills>` switcher. Extract a generic `<PillGroup>` for consistent pill styling across TrendView.

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react, Recharts

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/components/DateNavigator.tsx` | Compact single-row date/week navigator with dropdown |
| `src/components/SubViewPills.tsx` | Pill switcher for sub-views with badge counts |
| `src/components/PillGroup.tsx` | Generic pill group container (used by SubViewPills and TrendView) |
| `tests/components/DateNavigator.test.tsx` | Tests for DateNavigator |
| `tests/components/SubViewPills.test.tsx` | Tests for SubViewPills |
| `tests/components/PillGroup.test.tsx` | Tests for PillGroup |

### Modified Files
| File | Change |
|------|--------|
| `src/App.tsx` | 3 tabs, `subView` state, render DateNavigator + SubViewPills for "detail" tab |
| `src/views/DailyView.tsx` | Remove ~100 lines of week nav + date selector UI, simplify props |
| `src/CommitsView.tsx` | Remove ~15 lines of date button bar, simplify props |
| `src/PlanSpecView.tsx` | Remove `activeDate`/`onDateSelect` props (provided by parent) |
| `src/views/TrendView.tsx` | Range selector uses PillGroup |
| `src/views/WeeklyView.tsx` | Replace `onDateSelectAndSwitchToCommits` with `onDateSelect` |
| `src/components.tsx` | Remove `tabStyle` export |
| `tests/components/DailyView.test.tsx` | Update props (remove week nav props) |
| `tests/components/CommitsView.test.tsx` | Update props (remove dailyDates/dayLabels) |
| `tests/components/WeeklyView.test.tsx` | Update `onDateSelectAndSwitchToCommits` → `onDateSelect` |

---

### Task 1: Create PillGroup Component

**Files:**
- Create: `src/components/PillGroup.tsx`
- Create: `tests/components/PillGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/PillGroup.test.tsx`:

```tsx
// tests/components/PillGroup.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PillGroup } from "../../src/components/PillGroup";

describe("PillGroup", () => {
  const items = [
    { key: "a", label: "Alpha" },
    { key: "b", label: "Beta" },
    { key: "c", label: "Gamma" },
  ];

  it("renders all pill labels", () => {
    render(<PillGroup items={items} activeKey="a" onSelect={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("highlights the active pill", () => {
    const { container } = render(<PillGroup items={items} activeKey="b" onSelect={() => {}} />);
    const activeBtn = screen.getByText("Beta").closest("button");
    expect(activeBtn?.style.background).toContain("#334155");
  });

  it("calls onSelect with the clicked key", () => {
    const onSelect = vi.fn();
    render(<PillGroup items={items} activeKey="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Gamma"));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("renders badge when provided", () => {
    const itemsWithBadge = [
      { key: "a", label: "Alpha" },
      { key: "b", label: "Beta", badge: 5, badgeColor: "#06b6d4" },
    ];
    render(<PillGroup items={itemsWithBadge} activeKey="a" onSelect={() => {}} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not render badge when badge is 0", () => {
    const itemsWithZero = [
      { key: "a", label: "Alpha", badge: 0, badgeColor: "#06b6d4" },
    ];
    render(<PillGroup items={itemsWithZero} activeKey="a" onSelect={() => {}} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/components/PillGroup.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/components/PillGroup.tsx`:

```tsx
// src/components/PillGroup.tsx
import { COLORS } from "../constants";

export interface PillItem {
  key: string;
  label: string;
  badge?: number;
  badgeColor?: string;
}

interface PillGroupProps {
  items: PillItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

export function PillGroup({ items, activeKey, onSelect }: PillGroupProps) {
  return (
    <div style={{
      display: "flex", gap: 3, background: COLORS.card, borderRadius: 8,
      padding: 3, width: "fit-content",
    }}>
      {items.map(item => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
              fontFamily: "inherit", border: "none", cursor: "pointer",
              transition: "all 0.15s",
              color: isActive ? COLORS.text : COLORS.textDim,
              background: isActive ? "#334155" : "transparent",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {item.label}
            {item.badge != null && item.badge > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                minWidth: 18, textAlign: "center",
                background: (item.badgeColor || COLORS.teal) + "22",
                color: item.badgeColor || COLORS.teal,
              }}>
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/components/PillGroup.test.tsx`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/PillGroup.tsx tests/components/PillGroup.test.tsx
git commit -m "feat: add PillGroup component for reusable pill selector"
```

---

### Task 2: Create DateNavigator Component

**Files:**
- Create: `src/components/DateNavigator.tsx`
- Create: `tests/components/DateNavigator.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/DateNavigator.test.tsx`:

```tsx
// tests/components/DateNavigator.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateNavigator } from "../../src/components/DateNavigator";

const baseProps = {
  dates: ["3/24", "3/25", "3/26", "3/27", "3/28"],
  activeDate: "3/25",
  onDateSelect: vi.fn(),
  dayLabels: { "3/24": "一", "3/25": "二", "3/26": "三", "3/27": "四", "3/28": "五" } as Record<string, string>,
  weeks: [
    { dates: ["3/17", "3/18", "3/19"], label: "3/17 – 3/21" },
    { dates: ["3/24", "3/25", "3/26", "3/27", "3/28"], label: "3/24 – 3/28" },
  ],
  weekIndex: 1,
  canGoPrev: true,
  canGoNext: false,
  onPrevWeek: vi.fn(),
  onNextWeek: vi.fn(),
  onSelectWeek: vi.fn(),
};

describe("DateNavigator", () => {
  it("renders all date numbers", () => {
    render(<DateNavigator {...baseProps} />);
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
  });

  it("renders day-of-week labels", () => {
    render(<DateNavigator {...baseProps} />);
    expect(screen.getByText("一")).toBeInTheDocument();
    expect(screen.getByText("二")).toBeInTheDocument();
  });

  it("highlights the active date", () => {
    const { container } = render(<DateNavigator {...baseProps} />);
    const btn25 = screen.getByText("25").closest("button");
    expect(btn25?.style.background).toContain("#06b6d4");
  });

  it("calls onDateSelect when clicking a date", () => {
    const onDateSelect = vi.fn();
    render(<DateNavigator {...baseProps} onDateSelect={onDateSelect} />);
    fireEvent.click(screen.getByText("26"));
    expect(onDateSelect).toHaveBeenCalledWith("3/26");
  });

  it("calls onPrevWeek when clicking ◀", () => {
    const onPrevWeek = vi.fn();
    render(<DateNavigator {...baseProps} onPrevWeek={onPrevWeek} />);
    fireEvent.click(screen.getByText("◀"));
    expect(onPrevWeek).toHaveBeenCalled();
  });

  it("disables ▶ when canGoNext is false", () => {
    render(<DateNavigator {...baseProps} canGoNext={false} />);
    const nextBtn = screen.getByText("▶");
    expect(nextBtn).toBeDisabled();
  });

  it("shows week label button", () => {
    render(<DateNavigator {...baseProps} />);
    expect(screen.getByText(/W\d+/)).toBeInTheDocument();
  });

  it("opens week dropdown on click and shows all weeks", () => {
    render(<DateNavigator {...baseProps} />);
    fireEvent.click(screen.getByText(/W\d+/));
    expect(screen.getByText("3/17 – 3/21")).toBeInTheDocument();
    expect(screen.getByText("3/24 – 3/28")).toBeInTheDocument();
  });

  it("shows 本週 and 上週 shortcuts in dropdown", () => {
    render(<DateNavigator {...baseProps} />);
    fireEvent.click(screen.getByText(/W\d+/));
    expect(screen.getByText("本週")).toBeInTheDocument();
    expect(screen.getByText("上週")).toBeInTheDocument();
  });

  it("calls onSelectWeek when clicking a week in dropdown", () => {
    const onSelectWeek = vi.fn();
    render(<DateNavigator {...baseProps} onSelectWeek={onSelectWeek} />);
    fireEvent.click(screen.getByText(/W\d+/));
    fireEvent.click(screen.getByText("3/17 – 3/21"));
    expect(onSelectWeek).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/components/DateNavigator.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/components/DateNavigator.tsx`:

```tsx
// src/components/DateNavigator.tsx
import { useState, useRef, useEffect } from "react";
import { COLORS } from "../constants";

interface Week {
  dates: string[];
  label: string;
}

interface DateNavigatorProps {
  dates: string[];
  activeDate: string;
  onDateSelect: (d: string) => void;
  dayLabels: Record<string, string>;
  weeks: Week[];
  weekIndex: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSelectWeek: (i: number) => void;
}

export function DateNavigator({
  dates, activeDate, onDateSelect, dayLabels,
  weeks, weekIndex, canGoPrev, canGoNext,
  onPrevWeek, onNextWeek, onSelectWeek,
}: DateNavigatorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  // Compute ISO week number for display
  const getWeekNumber = (dateStr: string): number => {
    const [m, d] = dateStr.split("/").map(Number);
    const date = new Date(new Date().getFullYear(), m - 1, d);
    const jan1 = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
    return Math.ceil((days + jan1.getDay() + 1) / 7);
  };

  const weekNum = dates.length > 0 ? getWeekNumber(dates[0]) : 0;

  // Determine this-week and last-week indices for shortcuts
  const thisWeekIndex = weeks.length > 0 ? weeks.length - 1 : -1;
  const lastWeekIndex = weeks.length > 1 ? weeks.length - 2 : -1;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, marginBottom: 16,
      background: COLORS.card, borderRadius: 10, padding: "6px 10px",
    }}>
      <button
        onClick={onPrevWeek}
        disabled={!canGoPrev}
        style={{
          background: "none", border: "none", color: canGoPrev ? "#475569" : COLORS.border,
          fontSize: 13, cursor: canGoPrev ? "pointer" : "default", padding: "4px 2px",
          fontFamily: "inherit", transition: "color 0.15s",
        }}
      >◀</button>

      <div style={{ display: "flex", gap: 3, flex: 1 }}>
        {dates.map(d => {
          const isActive = d === activeDate;
          const dayNum = d.split("/")[1];
          return (
            <button
              key={d}
              onClick={() => onDateSelect(d)}
              style={{
                flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 6,
                fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                background: isActive ? "#06b6d4" : "transparent",
                color: isActive ? "#0f172a" : COLORS.textMuted,
                border: "none", fontFamily: "inherit",
              }}
            >
              {dayNum}
              <span style={{
                display: "block", fontSize: 9, fontWeight: 400, marginTop: 1,
                opacity: isActive ? 0.7 : 0.5,
              }}>
                {dayLabels[d] || ""}
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={onNextWeek}
        disabled={!canGoNext}
        style={{
          background: "none", border: "none", color: canGoNext ? "#475569" : COLORS.border,
          fontSize: 13, cursor: canGoNext ? "pointer" : "default", padding: "4px 2px",
          fontFamily: "inherit", transition: "color 0.15s",
        }}
      >▶</button>

      <div style={{ width: 1, height: 22, background: COLORS.border, margin: "0 2px" }} />

      <div ref={dropdownRef} style={{ position: "relative" }}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          style={{
            background: "none", border: "none", color: COLORS.textDim, fontSize: 11,
            fontWeight: 500, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            padding: "4px 6px", borderRadius: 4, transition: "all 0.15s",
          }}
        >
          W{weekNum} ▾
        </button>

        {dropdownOpen && (
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 50,
            background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
            padding: 4, minWidth: 180, maxHeight: 280, overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          }}>
            {/* Shortcuts */}
            <div style={{ display: "flex", gap: 4, padding: "4px 8px 8px", borderBottom: `1px solid ${COLORS.border}` }}>
              <button
                onClick={() => { if (thisWeekIndex >= 0) { onSelectWeek(thisWeekIndex); setDropdownOpen(false); } }}
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  fontFamily: "inherit", border: `1px solid ${COLORS.accent}44`,
                  background: weekIndex === thisWeekIndex ? "rgba(59,130,246,0.15)" : "transparent",
                  color: weekIndex === thisWeekIndex ? COLORS.accentLight : COLORS.textDim,
                  cursor: "pointer",
                }}
              >本週</button>
              <button
                onClick={() => { if (lastWeekIndex >= 0) { onSelectWeek(lastWeekIndex); setDropdownOpen(false); } }}
                disabled={lastWeekIndex < 0}
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  fontFamily: "inherit", border: `1px solid ${COLORS.border}`,
                  background: weekIndex === lastWeekIndex ? "rgba(59,130,246,0.15)" : "transparent",
                  color: lastWeekIndex < 0 ? COLORS.border : (weekIndex === lastWeekIndex ? COLORS.accentLight : COLORS.textDim),
                  cursor: lastWeekIndex < 0 ? "default" : "pointer",
                  opacity: lastWeekIndex < 0 ? 0.4 : 1,
                }}
              >上週</button>
            </div>
            {/* Week list */}
            {weeks.map((w, i) => (
              <button
                key={i}
                onClick={() => { onSelectWeek(i); setDropdownOpen(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                  background: i === weekIndex ? "rgba(59,130,246,0.1)" : "transparent",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  borderLeft: i === weekIndex ? `3px solid ${COLORS.accent}` : "3px solid transparent",
                  color: i === weekIndex ? COLORS.accentLight : COLORS.textMuted,
                  fontSize: 12, fontWeight: i === weekIndex ? 700 : 500, fontFamily: "inherit",
                  transition: "background 0.1s",
                }}
              >{w.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/components/DateNavigator.test.tsx`
Expected: 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/DateNavigator.tsx tests/components/DateNavigator.test.tsx
git commit -m "feat: add DateNavigator component — compact single-row date/week nav"
```

---

### Task 3: Create SubViewPills Component

**Files:**
- Create: `src/components/SubViewPills.tsx`
- Create: `tests/components/SubViewPills.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/SubViewPills.test.tsx`:

```tsx
// tests/components/SubViewPills.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubViewPills } from "../../src/components/SubViewPills";
import type { CommitData, PlanAnalysisData } from "../../src/types";

const mockCommitData: CommitData = {
  commits: {
    "3/24": {
      Alice: { count: 5, projects: ["proj1"], items: [] },
      Bob: { count: 7, projects: ["proj2"], items: [] },
    },
  },
  analysis: {},
  projectRisks: [],
};

const mockPlanData: PlanAnalysisData = {
  analysisDate: "2026-03-24",
  period: "3/24",
  planSpecs: [
    { date: "3/24", member: "Alice", commit: { title: "spec", sha: "abc", project: "p", url: "", source: "gitlab" }, files: ["docs/spec.md"] },
    { date: "3/24", member: "Bob", commit: { title: "plan", sha: "def", project: "p", url: "", source: "gitlab" }, files: ["docs/plan.md"] },
  ],
  summary: { totalSpecCommits: 2, totalCorrelations: 0, membersWithSpecs: 2, matched: 0, unmatched: 0, partial: 0 },
};

describe("SubViewPills", () => {
  it("renders hours pill always", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={null} planAnalysisData={null} />);
    expect(screen.getByText("📊 工時")).toBeInTheDocument();
  });

  it("hides commits pill when commitData is null", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={null} planAnalysisData={null} />);
    expect(screen.queryByText(/Commits/)).not.toBeInTheDocument();
  });

  it("shows commits pill with badge count when commitData exists", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={mockCommitData} planAnalysisData={null} />);
    expect(screen.getByText(/Commits/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // 5 + 7
  });

  it("shows plan pill with badge when planAnalysisData has specs for activeDate", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={null} planAnalysisData={mockPlanData} />);
    expect(screen.getByText(/規劃/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("hides plan pill when no specs for activeDate", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/25" commitData={null} planAnalysisData={mockPlanData} />);
    expect(screen.queryByText(/規劃/)).not.toBeInTheDocument();
  });

  it("calls onViewChange when clicking a pill", () => {
    const onViewChange = vi.fn();
    render(<SubViewPills activeView="hours" onViewChange={onViewChange} activeDate="3/24" commitData={mockCommitData} planAnalysisData={null} />);
    fireEvent.click(screen.getByText(/Commits/));
    expect(onViewChange).toHaveBeenCalledWith("commits");
  });

  it("falls back to hours when active view is hidden", () => {
    const onViewChange = vi.fn();
    render(<SubViewPills activeView="commits" onViewChange={onViewChange} activeDate="3/24" commitData={null} planAnalysisData={null} />);
    expect(onViewChange).toHaveBeenCalledWith("hours");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/components/SubViewPills.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/components/SubViewPills.tsx`:

```tsx
// src/components/SubViewPills.tsx
import { useEffect } from "react";
import { COLORS } from "../constants";
import { PillGroup } from "./PillGroup";
import type { PillItem } from "./PillGroup";
import type { CommitData, PlanAnalysisData } from "../types";

type SubView = "hours" | "commits" | "planspec";

interface SubViewPillsProps {
  activeView: SubView;
  onViewChange: (view: SubView) => void;
  activeDate: string;
  commitData: CommitData | null;
  planAnalysisData: PlanAnalysisData | null;
}

export function SubViewPills({ activeView, onViewChange, activeDate, commitData, planAnalysisData }: SubViewPillsProps) {
  // Compute badge counts
  const commitCount = commitData?.commits?.[activeDate]
    ? Object.values(commitData.commits[activeDate]).reduce((sum, m) => sum + m.count, 0)
    : 0;

  const specCount = planAnalysisData?.planSpecs
    ? planAnalysisData.planSpecs.filter(s => s.date === activeDate).length
    : 0;

  const hasCommits = commitData !== null;
  const hasSpecs = planAnalysisData !== null && specCount > 0;

  // Build pill items
  const items: PillItem[] = [
    { key: "hours", label: "📊 工時" },
  ];
  if (hasCommits) {
    items.push({ key: "commits", label: "🔀 Commits", badge: commitCount, badgeColor: COLORS.teal });
  }
  if (hasSpecs) {
    items.push({ key: "planspec", label: "📋 規劃", badge: specCount, badgeColor: "#a78bfa" });
  }

  // Fallback if current view is hidden
  const validKeys = items.map(i => i.key);
  useEffect(() => {
    if (!validKeys.includes(activeView)) {
      onViewChange("hours");
    }
  }, [activeView, validKeys.join(",")]);

  return (
    <PillGroup
      items={items}
      activeKey={validKeys.includes(activeView) ? activeView : "hours"}
      onSelect={(key) => onViewChange(key as SubView)}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/components/SubViewPills.test.tsx`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/SubViewPills.tsx tests/components/SubViewPills.test.tsx
git commit -m "feat: add SubViewPills component with badge counts and fallback"
```

---

### Task 4: Refactor DailyView — Remove Date Navigation

**Files:**
- Modify: `src/views/DailyView.tsx`
- Modify: `tests/components/DailyView.test.tsx`

- [ ] **Step 1: Update the test to match new props**

Edit `tests/components/DailyView.test.tsx` — remove all week-nav-related props from `baseProps` and remove the week-label test:

```tsx
// tests/components/DailyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { DailyView } from "../../src/views/DailyView";

const baseProps = {
  activeDate: "3/10",
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
  it("renders member cards", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders chart panel title with activeDate", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText(/3\/10 個人工時/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (old props still expected)**

Run: `bun run test -- tests/components/DailyView.test.tsx`
Expected: FAIL — extra props type error or missing props

- [ ] **Step 3: Refactor DailyView**

Edit `src/views/DailyView.tsx`:
- Remove the entire `DailyViewProps` interface and replace with simplified version
- Remove `useState`, `useRef`, `useEffect` imports (dropdown state moved to DateNavigator)
- Remove lines 42-166 (dropdown state, week nav UI, date buttons)
- Keep only lines 168-241 (chart + member cards)

The new interface:

```typescript
interface DailyViewProps {
  activeDate: string;
  dailyBarData: Array<{ name: string; 開發: number; 會議: number; total: number | null; status?: string }>;
  chartHeight: number;
  memberColors: Record<string, string>;
  issueMap: Record<string, { severity: string; text: string }>;
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
}
```

Remove these props from the interface and destructuring: `dailyDates`, `onDateSelect`, `dayLabels`, `weeks`, `weekIndex`, `canGoPrev`, `canGoNext`, `isThisWeek`, `isLastWeek`, `onPrevWeek`, `onNextWeek`, `onThisWeek`, `onLastWeek`, `onSelectWeek`.

Remove the `useState`/`useRef`/`useEffect` for dropdown. Remove the entire `<div className="animate-in" style={{ animationDelay: "0.15s", marginBottom: 20 }}>` block (lines 65-166). Keep the chart and member grid blocks.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/components/DailyView.test.tsx`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/DailyView.tsx tests/components/DailyView.test.tsx
git commit -m "refactor: remove date nav UI from DailyView — now handled by DateNavigator"
```

---

### Task 5: Refactor CommitsView — Remove Date Buttons

**Files:**
- Modify: `src/CommitsView.tsx`
- Modify: `tests/components/CommitsView.test.tsx`

- [ ] **Step 1: Update CommitsView test props**

Edit `tests/components/CommitsView.test.tsx` — remove `onDateSelect`, `dailyDates`, `dayLabels` from `baseProps`:

Replace the `baseProps` object. Remove these three properties:
```diff
-  onDateSelect: vi.fn(),
-  dailyDates: ["3/18"],
-  dayLabels: { "3/18": "三" },
```

Also remove `planSpecs` prop if present (it was `planSpecs: null`).

- [ ] **Step 2: Run test to see current state**

Run: `bun run test -- tests/components/CommitsView.test.tsx`
Note the current pass/fail state.

- [ ] **Step 3: Refactor CommitsView**

Edit `src/CommitsView.tsx`:

1. Remove from `CommitsViewProps` interface: `onDateSelect`, `dailyDates`, `dayLabels`
2. Remove from destructuring in function signature
3. Remove lines 76-90 (the date-scroll button bar):
```tsx
// DELETE this entire block:
      <div style={{ marginBottom: 20 }}>
        <div className="date-scroll">
          {dailyDates.map(d => (
            // ...date buttons...
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/components/CommitsView.test.tsx`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/CommitsView.tsx tests/components/CommitsView.test.tsx
git commit -m "refactor: remove date button bar from CommitsView — now handled by DateNavigator"
```

---

### Task 6: Refactor PlanSpecView — Remove Date Props

**Files:**
- Modify: `src/PlanSpecView.tsx`
- Modify: `tests/components/PlanSpecView.test.tsx`

- [ ] **Step 1: Update PlanSpecView test**

Edit `tests/components/PlanSpecView.test.tsx` — remove `onDateSelect` from props.

- [ ] **Step 2: Refactor PlanSpecView**

Edit `src/PlanSpecView.tsx`:
1. Remove `onDateSelect` from `PlanSpecViewProps` interface
2. Remove `onDateSelect` from destructuring

- [ ] **Step 3: Run test to verify it passes**

Run: `bun run test -- tests/components/PlanSpecView.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/PlanSpecView.tsx tests/components/PlanSpecView.test.tsx
git commit -m "refactor: remove onDateSelect from PlanSpecView — date selection handled by parent"
```

---

### Task 7: Refactor WeeklyView — Replace onDateSelectAndSwitchToCommits

**Files:**
- Modify: `src/views/WeeklyView.tsx`
- Modify: `tests/components/WeeklyView.test.tsx`

- [ ] **Step 1: Update WeeklyView test**

Edit `tests/components/WeeklyView.test.tsx` — replace `onDateSelectAndSwitchToCommits` with `onDateSelect` in test props.

- [ ] **Step 2: Refactor WeeklyView**

Edit `src/views/WeeklyView.tsx`:
1. In `WeeklyViewProps`, rename `onDateSelectAndSwitchToCommits` to `onDateSelect`
2. In destructuring, rename the prop
3. In all `onClick` handlers that call `onDateSelectAndSwitchToCommits(d)`, change to `onDateSelect(d)`

- [ ] **Step 3: Run test to verify it passes**

Run: `bun run test -- tests/components/WeeklyView.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/views/WeeklyView.tsx tests/components/WeeklyView.test.tsx
git commit -m "refactor: WeeklyView uses onDateSelect — tab switching handled by App"
```

---

### Task 8: Refactor App.tsx — Wire Everything Together

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components.tsx`

- [ ] **Step 1: Update App.tsx**

This is the central wiring task. Edit `src/App.tsx`:

1. Add imports for new components:
```tsx
import { DateNavigator } from "./components/DateNavigator";
import { SubViewPills } from "./components/SubViewPills";
```

2. Change `view` state type and add `subView`:
```tsx
const [view, setView] = useState<"detail" | "trend" | "weekly">("detail");
const [subView, setSubView] = useState<"hours" | "commits" | "planspec">("hours");
```

3. Update tab array (lines 130-141) to 3 tabs:
```tsx
{[
  { key: "detail", label: "📅 每日詳情" },
  { key: "trend", label: "📈 趨勢" },
  { key: "weekly", label: "📋 週報" },
].map(tab => (
  <button key={tab.key} className={`tab-btn ${view === tab.key ? 'tab-active' : ''}`}
    onClick={() => setView(tab.key as any)} style={tabStyle(view === tab.key)}>
    {tab.label}
  </button>
))}
```

4. Replace the view rendering section (lines 143-185). For `view === "detail"`, render DateNavigator + SubViewPills + the sub-view:

```tsx
{view === "detail" && (
  <>
    <DateNavigator
      dates={dailyDates}
      activeDate={activeDate}
      onDateSelect={setSelectedDate}
      dayLabels={dayLabels}
      weeks={weekNav.weeks}
      weekIndex={weekNav.weekIndex}
      canGoPrev={weekNav.canGoPrev}
      canGoNext={weekNav.canGoNext}
      onPrevWeek={() => { weekNav.goToPrev(); setSelectedDate(null); }}
      onNextWeek={() => { weekNav.goToNext(); setSelectedDate(null); }}
      onSelectWeek={(i: number) => { weekNav.goToWeek(i); setSelectedDate(null); }}
    />
    <SubViewPills
      activeView={subView}
      onViewChange={setSubView}
      activeDate={activeDate}
      commitData={commitData}
      planAnalysisData={planAnalysisData}
    />
    <div style={{ marginTop: 16 }}>
      {subView === "hours" && (
        <DailyView
          activeDate={activeDate}
          dailyBarData={dailyBarData}
          chartHeight={chartHeight}
          memberColors={memberColors}
          issueMap={issueMap}
          commitData={commitData}
          leave={leave}
        />
      )}
      {subView === "commits" && commitData && (
        <CommitsView
          commitData={commitData}
          dates={dates}
          members={members}
          memberColors={memberColors}
          leave={leave}
          activeDate={activeDate}
          taskAnalysisData={taskAnalysisData}
          planSpecs={planAnalysisData?.planSpecs || null}
        />
      )}
      {subView === "planspec" && planAnalysisData && (
        <PlanSpecView
          planAnalysisData={planAnalysisData}
          members={members}
          memberColors={memberColors}
          dates={dates}
          activeDate={activeDate}
        />
      )}
    </div>
  </>
)}

{view === "trend" && (
  <TrendView trendRange={trendRange} onTrendRangeChange={setTrendRange}
    trendDates={trendDates} trendData={trendData} useWeeklyAgg={useWeeklyAgg}
    weekGroups={weekGroups} members={members} memberColors={memberColors}
    selectedMembers={selectedMembers} onToggleMember={toggleMember}
    onClearMembers={() => setSelectedMembers(new Set())}
    isMobile={isMobile} commitData={commitData} rawData={rawData!} leave={leave} />
)}

{view === "weekly" && (
  <WeeklyView weeklySummary={weeklySummary} chartHeight={chartHeight}
    members={members} memberColors={memberColors} selectedMembers={selectedMembers}
    onToggleMember={toggleMember} isMobile={isMobile} dates={dates}
    commitData={commitData} leave={leave}
    dailyDates={dailyDates} dayLabels={dayLabels}
    onDateSelect={(d: string) => { setSelectedDate(d); setSubView("commits"); setView("detail"); }} />
)}
```

5. Remove `dateSelectAndSwitchToCommits` function (lines 85-88) — replaced by inline handler in WeeklyView's `onDateSelect` prop.

- [ ] **Step 2: Remove tabStyle from components.tsx if no longer needed**

Check if `tabStyle` is still imported anywhere. If only used in App.tsx and it's still being used for the main tabs, keep it. If not, remove the export from `src/components.tsx`.

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components.tsx
git commit -m "feat: wire 3-tab structure with DateNavigator + SubViewPills in App"
```

---

### Task 9: Update TrendView Range Selector to Use PillGroup

**Files:**
- Modify: `src/views/TrendView.tsx`
- Modify: `tests/components/TrendView.test.tsx`

- [ ] **Step 1: Update TrendView**

Edit `src/views/TrendView.tsx`:

1. Add import:
```tsx
import { PillGroup } from "../components/PillGroup";
```

2. Replace the range selector buttons (lines 46-61) with PillGroup:
```tsx
<PillGroup
  items={[
    { key: "week", label: "1週" },
    { key: "2weeks", label: "2週" },
    { key: "month", label: "1月" },
    { key: "all", label: "全部" },
  ]}
  activeKey={trendRange}
  onSelect={onTrendRangeChange}
/>
```

3. Keep the date range text span after it.

- [ ] **Step 2: Run tests**

Run: `bun run test -- tests/components/TrendView.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/views/TrendView.tsx
git commit -m "refactor: TrendView range selector uses PillGroup for visual consistency"
```

---

### Task 10: Run Full Test Suite and Fix Any Breakage

**Files:**
- Potentially any test file

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All 139+ tests PASS

- [ ] **Step 2: Fix any failing tests**

If any tests fail due to prop changes missed in earlier tasks, fix them here.

- [ ] **Step 3: Run dev server and visual check**

Run: `bun run dev`
Open `http://localhost:5173` and verify:
- 3 tabs render correctly
- DateNavigator shows compact single-row layout
- Sub-view pills switch between 工時/Commits/規劃
- Badge numbers are correct
- Date persists when switching sub-views
- Week navigation (◀ ▶ and W▾ dropdown) works
- TrendView range selector uses new pill style
- Mobile responsive (resize browser to <768px)

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: resolve test breakage from tab restructure"
```

---

### Task 11: Add Playwright E2E Tests

**Files:**
- Create: `tests/e2e/tab-restructure.spec.ts`

- [ ] **Step 1: Write E2E tests**

Create `tests/e2e/tab-restructure.spec.ts`:

```typescript
// tests/e2e/tab-restructure.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Tab Restructure", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5173");
    await page.waitForSelector(".tab-btn");
  });

  test("renders 3 main tabs", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText("每日詳情");
    await expect(tabs.nth(1)).toContainText("趨勢");
    await expect(tabs.nth(2)).toContainText("週報");
  });

  test("sub-view pills switch content", async ({ page }) => {
    // Default is 每日詳情 > 工時
    await expect(page.locator("text=個人工時")).toBeVisible();

    // Click Commits sub-pill if visible
    const commitsPill = page.locator("button", { hasText: "Commits" });
    if (await commitsPill.isVisible()) {
      await commitsPill.click();
      await expect(page.locator("text=Commits 關聯分析")).toBeVisible();
    }
  });

  test("date persists when switching sub-views", async ({ page }) => {
    // Select a specific date
    const dateButtons = page.locator("button").filter({ hasText: /^\d{1,2}$/ });
    const secondDate = dateButtons.nth(1);
    await secondDate.click();

    // Switch to Commits sub-view
    const commitsPill = page.locator("button", { hasText: "Commits" });
    if (await commitsPill.isVisible()) {
      await commitsPill.click();
      // The same date button should still be active (has teal background)
      await expect(secondDate).toHaveCSS("background-color", "rgb(6, 182, 212)");
    }
  });

  test("week navigation arrows work", async ({ page }) => {
    const prevBtn = page.locator("button", { hasText: "◀" });
    const nextBtn = page.locator("button", { hasText: "▶" });

    // If prev is enabled, click it and verify dates change
    if (await prevBtn.isEnabled()) {
      const datesBefore = await page.locator("button").filter({ hasText: /^\d{1,2}$/ }).allTextContents();
      await prevBtn.click();
      const datesAfter = await page.locator("button").filter({ hasText: /^\d{1,2}$/ }).allTextContents();
      expect(datesBefore).not.toEqual(datesAfter);
    }
  });

  test("tab switching works", async ({ page }) => {
    // Click 趨勢
    await page.locator(".tab-btn", { hasText: "趨勢" }).click();
    await expect(page.locator("text=每日工時趨勢")).toBeVisible();

    // Click 週報
    await page.locator(".tab-btn", { hasText: "週報" }).click();
    await expect(page.locator("text=日均工時分佈")).toBeVisible();

    // Click back to 每日詳情
    await page.locator(".tab-btn", { hasText: "每日詳情" }).click();
    await expect(page.locator("text=個人工時")).toBeVisible();
  });

  test("mobile responsive — tabs don't wrap", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const tabBar = page.locator(".tab-bar");
    const tabBarBox = await tabBar.boundingBox();
    expect(tabBarBox?.height).toBeLessThan(60); // Single row
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run: `npx playwright test tests/e2e/tab-restructure.spec.ts`
(Requires dev server running in another terminal: `bun run dev`)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/tab-restructure.spec.ts
git commit -m "test: add Playwright E2E tests for tab restructure"
```
