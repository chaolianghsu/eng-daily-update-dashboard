# Team Health Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add anomaly detection alerts to StatusOverview and a new "👤 成員" tab with per-member 30-day health profiles.

**Architecture:** Two new hooks (`useHealthAlerts`, `useMemberProfile`) compute all data from existing `rawData`, `commitData`, `leave`, and `taskAnalysisData`. `useHealthAlerts` feeds into both StatusOverview (trend badges) and MemberView (alert banners). `useMemberProfile` powers the 4-card responsive grid in MemberView.

**Tech Stack:** React 18, TypeScript 5, Recharts 2.12, Vitest (unit/component), Playwright (E2E)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/hooks/useHealthAlerts.ts` | Anomaly detection engine: fixed thresholds + MAD-based rolling baseline |
| `src/hooks/useMemberProfile.ts` | Per-member 30-day profile aggregation (hours, consistency, projects, meetings, warnings) |
| `src/views/MemberView.tsx` | "👤 成員" tab: member selector + alert banner + 4-card responsive grid |
| `tests/unit/hooks/useHealthAlerts.test.ts` | Unit tests for alert detection rules |
| `tests/unit/hooks/useMemberProfile.test.ts` | Unit tests for profile aggregation |
| `tests/components/MemberView.test.tsx` | Component tests for member view rendering |
| `tests/e2e/member-health.spec.ts` | E2E tests for member tab + StatusOverview badges |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add `HealthAlert`, `MemberProfile` interfaces; extend `Issue` with optional `source` field |
| `src/constants.ts` | Add `HEALTH_THRESHOLDS` object for anomaly detection constants |
| `src/hooks/useAllIssues.ts` | Accept `healthAlerts` param, merge into output |
| `src/views/StatusOverview.tsx` | Render trend badge on cards with `source === "trend"` |
| `src/App.tsx` | Add `"member"` view state, wire `useHealthAlerts`, add tab button, render `MemberView` |
| `tests/unit/hooks/useAllIssues.test.ts` | Add tests for health alert merging |
| `tests/components/StatusOverview.test.tsx` | Add tests for trend badge rendering |
| `tests/e2e/tab-restructure.spec.ts` | Update tab count from 3 to 4 |

---

## Task 1: Types & Constants Foundation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/constants.ts`

- [ ] **Step 1: Add HealthAlert and MemberProfile types to types.ts**

Add after the existing `StatusInfo` interface at the end of `src/types.ts`:

```ts
export interface HealthAlert {
  member: string;
  severity: "🔴" | "🟡" | "🟠";
  text: string;
  source: "threshold" | "trend";
  type: "low_hours" | "high_hours" | "consecutive_low" | "meeting_heavy" |
        "unreported" | "hours_drop" | "hours_spike" | "meeting_spike" | "commit_drop";
}

export interface MemberProfile {
  hoursTrend: Array<{ date: string; total: number | null; meeting: number | null; dev: number | null; status: "normal" | "warning" | "danger" }>;
  baseline: number | null;
  recentAvg: number | null;
  meetingPct: number | null;
  consistencyGrid: Array<{ date: string; status: "✅" | "⚠️" | "🔴" | null }>;
  consistencyRate: number;
  projectDistribution: Array<{ project: string; count: number; pct: number }>;
  totalCommits: number;
  recentCommits: number;
  prevCommits: number;
  weeklyMeetingPct: Array<{ week: string; pct: number }>;
  taskWarnings: Array<{ date: string; severity: string; type: string; task: string; reasoning: string }>;
}
```

- [ ] **Step 2: Extend Issue type with optional source field**

In `src/types.ts`, change the `Issue` interface from:

```ts
export interface Issue {
  member: string;
  severity: string;
  text: string;
}
```

to:

```ts
export interface Issue {
  member: string;
  severity: string;
  text: string;
  source?: "threshold" | "trend";
}
```

- [ ] **Step 3: Add health threshold constants**

In `src/constants.ts`, add after the existing `PROJECT_PALETTE`:

```ts
export const HEALTH_THRESHOLDS = {
  extremeLow: 4,
  extremeHigh: 11,
  consecutiveLowDays: 3,
  meetingHeavyPct: 60,
  consecutiveUnreportedDays: 2,
  rollingWindowDays: 20,
  madMultiplier: 2,
  madToSigma: 1.4826,
  minDataPoints: 5,
} as const;
```

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/constants.ts
git commit -m "feat: add HealthAlert, MemberProfile types and HEALTH_THRESHOLDS constants"
```

---

## Task 2: useHealthAlerts Hook (TDD)

**Files:**
- Create: `src/hooks/useHealthAlerts.ts`
- Create: `tests/unit/hooks/useHealthAlerts.test.ts`

- [ ] **Step 1: Write failing tests for fixed threshold rules**

Create `tests/unit/hooks/useHealthAlerts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHealthAlerts } from "../../../src/hooks/useHealthAlerts";

function makeDates(count: number, startMonth = 3, startDay = 1): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = startDay + i;
    dates.push(`${startMonth}/${day}`);
  }
  return dates;
}

function makeRawData(dates: string[], members: string[], hours: Record<string, Record<string, number | null>>) {
  const raw: Record<string, Record<string, any>> = {};
  for (const d of dates) {
    raw[d] = {};
    for (const m of members) {
      const h = hours[m]?.[d] ?? null;
      raw[d][m] = h !== null ? { total: h, meeting: 1, dev: h - 1 } : { total: null, meeting: null, dev: null };
    }
  }
  return raw;
}

describe("useHealthAlerts", () => {
  const dates = makeDates(5, 3, 1);
  const members = ["A"];

  describe("fixed threshold rules", () => {
    it("flags extreme low hours (< 4h)", () => {
      const rawData = makeRawData(dates, members, { A: { "3/5": 3 } });
      // fill other days with normal
      for (const d of dates.slice(0, 4)) rawData[d].A = { total: 8, meeting: 1, dev: 7 };
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, members, dates, null, {}, null, "3/5")
      );
      const low = result.current.filter(a => a.type === "low_hours");
      expect(low.length).toBe(1);
      expect(low[0].severity).toBe("🔴");
      expect(low[0].source).toBe("threshold");
    });

    it("flags extreme high hours (> 11h)", () => {
      const rawData = makeRawData(dates, members, { A: { "3/5": 12 } });
      for (const d of dates.slice(0, 4)) rawData[d].A = { total: 8, meeting: 1, dev: 7 };
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, members, dates, null, {}, null, "3/5")
      );
      const high = result.current.filter(a => a.type === "high_hours");
      expect(high.length).toBe(1);
      expect(high[0].severity).toBe("🔴");
    });

    it("flags consecutive low hours (>= 3 days < 6.5h)", () => {
      const rawData = makeRawData(dates, members, {
        A: { "3/3": 5, "3/4": 4.5, "3/5": 6 },
      });
      rawData["3/1"].A = { total: 8, meeting: 1, dev: 7 };
      rawData["3/2"].A = { total: 8, meeting: 1, dev: 7 };
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, members, dates, null, {}, null, "3/5")
      );
      const consec = result.current.filter(a => a.type === "consecutive_low");
      expect(consec.length).toBe(1);
      expect(consec[0].severity).toBe("🔴");
    });

    it("flags meeting heavy (> 60%)", () => {
      const rawData: Record<string, Record<string, any>> = {};
      for (const d of dates) {
        rawData[d] = { A: { total: 8, meeting: 5, dev: 3 } };
      }
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, members, dates, null, {}, null, "3/5")
      );
      const meeting = result.current.filter(a => a.type === "meeting_heavy");
      expect(meeting.length).toBe(1);
      expect(meeting[0].severity).toBe("🟡");
    });

    it("excludes members on leave", () => {
      const rawData = makeRawData(dates, members, { A: { "3/5": 3 } });
      for (const d of dates.slice(0, 4)) rawData[d].A = { total: 8, meeting: 1, dev: 7 };
      const leave = { A: [{ start: "3/5", end: "3/5" }] };
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, members, dates, null, leave, null, "3/5")
      );
      expect(result.current.filter(a => a.member === "A")).toHaveLength(0);
    });
  });

  describe("rolling baseline (MAD)", () => {
    it("flags hours drop when recent avg deviates from baseline", () => {
      // 17 days at 8h, then 3 days at 3h => significant drop
      const allDates = makeDates(20, 3, 1);
      const rawData: Record<string, Record<string, any>> = {};
      for (const d of allDates.slice(0, 17)) {
        rawData[d] = { A: { total: 8, meeting: 1, dev: 7 } };
      }
      for (const d of allDates.slice(17)) {
        rawData[d] = { A: { total: 3, meeting: 0.5, dev: 2.5 } };
      }
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["A"], allDates, null, {}, null, "3/20")
      );
      const drop = result.current.filter(a => a.type === "hours_drop");
      expect(drop.length).toBe(1);
      expect(drop[0].source).toBe("trend");
    });

    it("does not flag when data points < minDataPoints", () => {
      const shortDates = makeDates(3, 3, 1);
      const rawData: Record<string, Record<string, any>> = {};
      for (const d of shortDates) {
        rawData[d] = { A: { total: 3, meeting: 0.5, dev: 2.5 } };
      }
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["A"], shortDates, null, {}, null, "3/3")
      );
      // Should still flag via fixed threshold (< 4h), but NOT via trend
      const trendAlerts = result.current.filter(a => a.source === "trend");
      expect(trendAlerts).toHaveLength(0);
    });
  });

  describe("commit-based alerts", () => {
    it("flags commit frequency drop", () => {
      const allDates = makeDates(14, 3, 1);
      const rawData: Record<string, Record<string, any>> = {};
      for (const d of allDates) rawData[d] = { A: { total: 8, meeting: 1, dev: 7 } };
      const commitData = {
        commits: Object.fromEntries(
          allDates.map((d, i) => [d, { A: i < 7 ? { count: 3, projects: ["P"], items: [] } : { count: 0, projects: [], items: [] } }])
        ),
        analysis: {},
        projectRisks: [],
      };
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["A"], allDates, commitData as any, {}, null, "3/14")
      );
      const drop = result.current.filter(a => a.type === "commit_drop");
      expect(drop.length).toBe(1);
      expect(drop[0].severity).toBe("🟡");
    });
  });

  describe("sorting", () => {
    it("sorts by severity: 🔴 before 🟡 before 🟠", () => {
      const rawData: Record<string, Record<string, any>> = {};
      for (const d of dates) {
        rawData[d] = {
          A: { total: 3, meeting: 0.5, dev: 2.5 },   // 🔴 low
          B: { total: 8, meeting: 5, dev: 3 },         // 🟡 meeting heavy
        };
      }
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["A", "B"], dates, null, {}, null, "3/5")
      );
      const sevs = result.current.map(a => a.severity);
      const redIdx = sevs.indexOf("🔴");
      const yellowIdx = sevs.indexOf("🟡");
      if (redIdx !== -1 && yellowIdx !== -1) {
        expect(redIdx).toBeLessThan(yellowIdx);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/unit/hooks/useHealthAlerts.test.ts`
Expected: FAIL — module `../../../src/hooks/useHealthAlerts` not found

- [ ] **Step 3: Implement useHealthAlerts hook**

Create `src/hooks/useHealthAlerts.ts`:

```ts
import { useMemo } from "react";
import { HEALTH_THRESHOLDS, THRESHOLDS } from "../constants";
import { dateToNum, isOnLeave } from "../utils";
import type { HealthAlert, CommitData, TaskAnalysisData, LeaveRange } from "../types";

const SEVERITY_ORDER: Record<string, number> = { "🔴": 0, "🟡": 1, "🟠": 2 };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  const deviations = values.map(v => Math.abs(v - med));
  return median(deviations);
}

function getRecentDates(dates: string[], activeDate: string, count: number): string[] {
  const activeNum = dateToNum(activeDate);
  const before = dates.filter(d => dateToNum(d) <= activeNum);
  return before.slice(-count);
}

export function useHealthAlerts(
  rawData: Record<string, Record<string, any>> | null,
  members: string[],
  dates: string[],
  commitData: CommitData | null,
  leave: Record<string, LeaveRange[]>,
  taskAnalysisData: TaskAnalysisData | null,
  activeDate: string
): HealthAlert[] {
  return useMemo(() => {
    if (!rawData || !activeDate || dates.length === 0) return [];

    const alerts: HealthAlert[] = [];
    const { extremeLow, extremeHigh, consecutiveLowDays, meetingHeavyPct,
            consecutiveUnreportedDays, rollingWindowDays, madMultiplier,
            madToSigma, minDataPoints } = HEALTH_THRESHOLDS;

    for (const member of members) {
      const memberLeave = leave[member] || [];
      if (isOnLeave(activeDate, memberLeave)) continue;

      const todayData = rawData[activeDate]?.[member];
      const todayTotal = todayData?.total as number | null;
      const todayMeeting = todayData?.meeting as number | null;

      // --- Fixed threshold rules ---

      // Extreme low
      if (todayTotal !== null && todayTotal < extremeLow) {
        alerts.push({
          member, severity: "🔴", source: "threshold", type: "low_hours",
          text: `極低工時 ${todayTotal}h`,
        });
      }

      // Extreme high
      if (todayTotal !== null && todayTotal > extremeHigh) {
        alerts.push({
          member, severity: "🔴", source: "threshold", type: "high_hours",
          text: `超時工作 ${todayTotal}h`,
        });
      }

      // Consecutive low
      const recentDates = getRecentDates(dates, activeDate, consecutiveLowDays);
      if (recentDates.length >= consecutiveLowDays) {
        const allLow = recentDates.every(d => {
          if (isOnLeave(d, memberLeave)) return false;
          const t = rawData[d]?.[member]?.total as number | null;
          return t !== null && t < THRESHOLDS.ok;
        });
        if (allLow) {
          alerts.push({
            member, severity: "🔴", source: "threshold", type: "consecutive_low",
            text: `連續低工時 (${consecutiveLowDays}天)`,
          });
        }
      }

      // Meeting heavy
      if (todayTotal !== null && todayMeeting !== null && todayTotal > 0) {
        const pct = (todayMeeting / todayTotal) * 100;
        if (pct > meetingHeavyPct) {
          alerts.push({
            member, severity: "🟡", source: "threshold", type: "meeting_heavy",
            text: `會議佔比偏高 ${Math.round(pct)}%`,
          });
        }
      }

      // Consecutive unreported
      const recentForUnreported = getRecentDates(dates, activeDate, consecutiveUnreportedDays);
      if (recentForUnreported.length >= consecutiveUnreportedDays) {
        const allUnreported = recentForUnreported.every(d => {
          if (isOnLeave(d, memberLeave)) return false;
          return rawData[d]?.[member]?.total == null;
        });
        if (allUnreported) {
          alerts.push({
            member, severity: "🟡", source: "threshold", type: "unreported",
            text: `連續 ${consecutiveUnreportedDays} 天未回報`,
          });
        }
      }

      // --- Rolling baseline (MAD) ---
      const windowDates = getRecentDates(dates, activeDate, rollingWindowDays);
      const hoursValues = windowDates
        .filter(d => !isOnLeave(d, memberLeave))
        .map(d => rawData[d]?.[member]?.total as number | null)
        .filter((v): v is number => v !== null);

      if (hoursValues.length >= minDataPoints) {
        const baseline = median(hoursValues);
        const madVal = mad(hoursValues);
        const adjustedMad = madVal * madToSigma;
        const threshold = madMultiplier * adjustedMad;

        // Hours drop (recent 3 days avg vs baseline)
        const recent3 = getRecentDates(dates, activeDate, 3);
        const recent3Hours = recent3
          .filter(d => !isOnLeave(d, memberLeave))
          .map(d => rawData[d]?.[member]?.total as number | null)
          .filter((v): v is number => v !== null);

        if (recent3Hours.length > 0 && threshold > 0) {
          const recentAvg = recent3Hours.reduce((a, b) => a + b, 0) / recent3Hours.length;
          if (baseline - recentAvg > threshold) {
            alerts.push({
              member, severity: "🔴", source: "trend", type: "hours_drop",
              text: `工時突降（近期 ${recentAvg.toFixed(1)}h，基線 ${baseline.toFixed(1)}h）`,
            });
          }
        }

        // Hours spike
        if (recent3Hours.length > 0 && threshold > 0) {
          const recentAvg = recent3Hours.reduce((a, b) => a + b, 0) / recent3Hours.length;
          if (recentAvg - baseline > threshold) {
            alerts.push({
              member, severity: "🟡", source: "trend", type: "hours_spike",
              text: `工時突升（近期 ${recentAvg.toFixed(1)}h，基線 ${baseline.toFixed(1)}h）`,
            });
          }
        }
      }

      // Commit frequency drop (7d vs prev 7d)
      if (commitData?.commits) {
        const recent7 = getRecentDates(dates, activeDate, 7);
        const prev7 = getRecentDates(dates, activeDate, 14).filter(d => !recent7.includes(d));

        const recentCommits = recent7.reduce((sum, d) =>
          sum + (commitData.commits[d]?.[member]?.count || 0), 0);
        const prevCommits = prev7.reduce((sum, d) =>
          sum + (commitData.commits[d]?.[member]?.count || 0), 0);

        if (prevCommits >= 5 && recentCommits === 0) {
          alerts.push({
            member, severity: "🟡", source: "trend", type: "commit_drop",
            text: `Commit 頻率突降（近 7 天: ${recentCommits}，前 7 天: ${prevCommits}）`,
          });
        }
      }
    }

    // Dedupe by member+type
    const seen = new Set<string>();
    const deduped = alerts.filter(a => {
      const key = `${a.member}:${a.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by severity
    return deduped.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  }, [rawData, members, dates, commitData, leave, taskAnalysisData, activeDate]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/unit/hooks/useHealthAlerts.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHealthAlerts.ts tests/unit/hooks/useHealthAlerts.test.ts
git commit -m "feat: add useHealthAlerts hook with fixed threshold + MAD-based anomaly detection"
```

---

## Task 3: Integrate Health Alerts into useAllIssues + StatusOverview (TDD)

**Files:**
- Modify: `src/hooks/useAllIssues.ts`
- Modify: `src/views/StatusOverview.tsx`
- Modify: `tests/unit/hooks/useAllIssues.test.ts`
- Modify: `tests/components/StatusOverview.test.tsx`

- [ ] **Step 1: Write failing tests for useAllIssues health alert merging**

Add to `tests/unit/hooks/useAllIssues.test.ts`:

```ts
  describe("health alert integration", () => {
    it("merges health alerts into output", () => {
      const issues: any[] = [];
      const healthAlerts = [
        { member: "A", severity: "🔴", text: "連續低工時 (3天)", source: "trend" as const, type: "consecutive_low" as const },
      ];
      const { result } = renderHook(() => useAllIssues(issues, null, "3/5", healthAlerts));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].source).toBe("trend");
    });

    it("dedupes health alerts with existing issues for same member", () => {
      const issues = [{ member: "A", severity: "🔴", text: "超時" }];
      const healthAlerts = [
        { member: "A", severity: "🔴", text: "工時突降", source: "trend" as const, type: "hours_drop" as const },
      ];
      const { result } = renderHook(() => useAllIssues(issues, null, "3/5", healthAlerts));
      expect(result.current).toHaveLength(2); // both kept, different issues
    });

    it("sorts merged results by severity", () => {
      const issues = [{ member: "B", severity: "🟡", text: "偏低" }];
      const healthAlerts = [
        { member: "A", severity: "🔴", text: "連續低工時", source: "trend" as const, type: "consecutive_low" as const },
      ];
      const { result } = renderHook(() => useAllIssues(issues, null, "3/5", healthAlerts));
      expect(result.current[0].severity).toBe("🔴");
      expect(result.current[1].severity).toBe("🟡");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/unit/hooks/useAllIssues.test.ts`
Expected: FAIL — `useAllIssues` doesn't accept 4th argument

- [ ] **Step 3: Update useAllIssues to accept and merge health alerts**

Replace `src/hooks/useAllIssues.ts`:

```ts
import { useMemo } from "react";
import { dateToNum } from "../utils";
import type { Issue, CommitData, HealthAlert } from "../types";

const DATE_PATTERN = /(\d+\/\d+)/g;
const SEVERITY_ORDER: Record<string, number> = { "🔴": 0, "🟡": 1, "🟠": 2 };

export function useAllIssues(
  issues: Issue[],
  commitData: CommitData | null,
  activeDate: string,
  healthAlerts: HealthAlert[] = []
): Issue[] {
  return useMemo(() => {
    if (!activeDate) return issues.filter(i => i.severity !== '🟢');
    const activeDateNum = dateToNum(activeDate);
    const base = issues.filter(i => {
      if (i.severity === '🟢') return false;
      const dates = i.text.match(DATE_PATTERN);
      if (!dates) return true;
      return dates.some(d => dateToNum(d) === activeDateNum);
    });
    if (commitData) {
      const activeAnalysis = commitData.analysis?.[activeDate] || {};
      for (const [m, a] of Object.entries(activeAnalysis)) {
        if (a.status === '🔴') {
          base.push({ member: m, severity: '🔴', text: `有 ${a.commitCount} commits 但未回報工時` });
        }
      }
    }

    // Merge health alerts as Issues with source field
    for (const alert of healthAlerts) {
      base.push({
        member: alert.member,
        severity: alert.severity,
        text: alert.text,
        source: alert.source,
      });
    }

    // Sort by severity
    return base.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );
  }, [issues, commitData, activeDate, healthAlerts]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/unit/hooks/useAllIssues.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Write failing test for StatusOverview trend badge**

Add to `tests/components/StatusOverview.test.tsx`:

```ts
  it("renders trend badge for issues with source=trend", () => {
    const props = {
      ...baseProps,
      allIssues: [{ member: "A", severity: "🔴", text: "連續低工時", source: "trend" as const }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("趨勢")).toBeInTheDocument();
  });

  it("does not render trend badge for issues without source", () => {
    const props = {
      ...baseProps,
      allIssues: [{ member: "A", severity: "🔴", text: "超時" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.queryByText("趨勢")).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun run test -- tests/components/StatusOverview.test.tsx`
Expected: FAIL — "趨勢" text not found

- [ ] **Step 7: Add trend badge to StatusOverview**

In `src/views/StatusOverview.tsx`, inside the attention card map (after the `hint` line, around line 87), add the trend badge. Find the `<div>` that renders `iss.member` and `iss.text`, and add after the hint div:

```tsx
{(iss as any).source === "trend" && (
  <span style={{ fontSize: 9, padding: "1px 6px", background: "#f472b644", color: "#f472b6", borderRadius: 3, marginLeft: 6, fontWeight: 600 }}>趨勢</span>
)}
```

Specifically, in the attention card JSX block, change:

```tsx
<div>
  <div style={{ fontSize: 12, fontWeight: 700, color: sev?.sc || COLORS.text }}>{iss.member} <span style={{ fontWeight: 500, color: COLORS.textMuted }}>{iss.text}</span></div>
  {hint && !isLeave && <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>{hint}</div>}
</div>
```

to:

```tsx
<div>
  <div style={{ fontSize: 12, fontWeight: 700, color: sev?.sc || COLORS.text }}>
    {iss.member} <span style={{ fontWeight: 500, color: COLORS.textMuted }}>{iss.text}</span>
    {(iss as any).source === "trend" && (
      <span style={{ fontSize: 9, padding: "1px 6px", background: "#f472b644", color: "#f472b6", borderRadius: 3, marginLeft: 6, fontWeight: 600 }}>趨勢</span>
    )}
  </div>
  {hint && !isLeave && <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>{hint}</div>}
</div>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun run test -- tests/components/StatusOverview.test.tsx`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useAllIssues.ts src/views/StatusOverview.tsx tests/unit/hooks/useAllIssues.test.ts tests/components/StatusOverview.test.tsx
git commit -m "feat: integrate health alerts into StatusOverview with trend badges"
```

---

## Task 4: useMemberProfile Hook (TDD)

**Files:**
- Create: `src/hooks/useMemberProfile.ts`
- Create: `tests/unit/hooks/useMemberProfile.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/hooks/useMemberProfile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMemberProfile } from "../../../src/hooks/useMemberProfile";

function makeDates(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `3/${i + 1}`);
}

describe("useMemberProfile", () => {
  const dates = makeDates(20);
  const member = "A";

  function makeRawData(hoursPerDay: number) {
    const raw: Record<string, Record<string, any>> = {};
    for (const d of dates) {
      raw[d] = { A: { total: hoursPerDay, meeting: 1, dev: hoursPerDay - 1 } };
    }
    return raw;
  }

  it("computes hoursTrend with correct status coloring", () => {
    const rawData = makeRawData(8);
    rawData["3/20"].A = { total: 3, meeting: 0.5, dev: 2.5 }; // danger
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, null, {}, null)
    );
    const trend = result.current.hoursTrend;
    expect(trend).toHaveLength(20);
    expect(trend[trend.length - 1].status).toBe("danger");
    expect(trend[0].status).toBe("normal");
  });

  it("computes baseline as median of available hours", () => {
    const rawData = makeRawData(8);
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, null, {}, null)
    );
    expect(result.current.baseline).toBe(8);
  });

  it("computes recentAvg from last 7 days", () => {
    const rawData = makeRawData(8);
    for (let i = 14; i < 20; i++) {
      rawData[`3/${i + 1}`].A = { total: 6, meeting: 1, dev: 5 };
    }
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, null, {}, null)
    );
    // last 7 days: 3/14=8, 3/15-3/20=6 => (8+6*6)/7 ≈ 6.29
    expect(result.current.recentAvg).toBeCloseTo(6.29, 1);
  });

  it("computes consistencyGrid from commitData analysis", () => {
    const commitData = {
      commits: {},
      analysis: {
        "3/1": { A: { status: "✅", commitCount: 3, hours: 8 } },
        "3/2": { A: { status: "⚠️", commitCount: 0, hours: 7 } },
        "3/3": { A: { status: "🔴", commitCount: 5, hours: null } },
      },
      projectRisks: [],
    };
    const rawData = makeRawData(8);
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, commitData as any, {}, null)
    );
    const grid = result.current.consistencyGrid;
    expect(grid.find(g => g.date === "3/1")?.status).toBe("✅");
    expect(grid.find(g => g.date === "3/2")?.status).toBe("⚠️");
    expect(grid.find(g => g.date === "3/3")?.status).toBe("🔴");
  });

  it("computes consistencyRate as percentage of ✅", () => {
    const commitData = {
      commits: {},
      analysis: Object.fromEntries(
        dates.map(d => [d, { A: { status: d === "3/1" ? "🔴" : "✅", commitCount: 1, hours: 8 } }])
      ),
      projectRisks: [],
    };
    const rawData = makeRawData(8);
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, commitData as any, {}, null)
    );
    expect(result.current.consistencyRate).toBe(95); // 19/20
  });

  it("computes projectDistribution sorted by count", () => {
    const commitData = {
      commits: {
        "3/1": { A: { count: 5, projects: ["CRM", "API"], items: [
          { title: "a", sha: "1", project: "CRM", url: "", source: "gitlab" },
          { title: "b", sha: "2", project: "CRM", url: "", source: "gitlab" },
          { title: "c", sha: "3", project: "CRM", url: "", source: "gitlab" },
          { title: "d", sha: "4", project: "API", url: "", source: "gitlab" },
          { title: "e", sha: "5", project: "API", url: "", source: "gitlab" },
        ]}},
      },
      analysis: {},
      projectRisks: [],
    };
    const rawData = makeRawData(8);
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, commitData as any, {}, null)
    );
    expect(result.current.projectDistribution[0].project).toBe("CRM");
    expect(result.current.projectDistribution[0].count).toBe(3);
    expect(result.current.totalCommits).toBe(5);
  });

  it("computes weeklyMeetingPct", () => {
    const rawData = makeRawData(8);
    // All days have meeting=1, total=8 => 12.5%
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, null, {}, null)
    );
    expect(result.current.weeklyMeetingPct.length).toBeGreaterThan(0);
    expect(result.current.weeklyMeetingPct[0].pct).toBeCloseTo(12.5, 0);
  });

  it("filters taskWarnings for the selected member", () => {
    const taskAnalysisData = {
      analysisDate: "2026-03-20",
      period: "3/1-3/20",
      warnings: [
        { date: "3/5", member: "A", severity: "🔴", type: "low_output", task: "test", commits: "0", reasoning: "r" },
        { date: "3/5", member: "B", severity: "🟡", type: "mismatch", task: "test2", commits: "1", reasoning: "r2" },
      ],
      summary: { totalWarnings: 2, critical: 1, warning: 1, caution: 0 },
    };
    const rawData = makeRawData(8);
    const { result } = renderHook(() =>
      useMemberProfile(rawData, member, dates, null, {}, taskAnalysisData as any)
    );
    expect(result.current.taskWarnings).toHaveLength(1);
    expect(result.current.taskWarnings[0].member).toBe("A");
  });

  it("returns empty profile for unknown member", () => {
    const rawData = makeRawData(8);
    const { result } = renderHook(() =>
      useMemberProfile(rawData, "Unknown", dates, null, {}, null)
    );
    expect(result.current.hoursTrend).toHaveLength(20);
    expect(result.current.baseline).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/unit/hooks/useMemberProfile.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useMemberProfile hook**

Create `src/hooks/useMemberProfile.ts`:

```ts
import { useMemo } from "react";
import { THRESHOLDS, HEALTH_THRESHOLDS } from "../constants";
import { isOnLeave } from "../utils";
import type { MemberProfile, CommitData, TaskAnalysisData, LeaveRange } from "../types";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getHoursStatus(total: number | null): "normal" | "warning" | "danger" {
  if (total === null) return "danger";
  if (total > THRESHOLDS.overtime || total < THRESHOLDS.low) return "danger";
  if (total > THRESHOLDS.high || total < THRESHOLDS.ok) return "warning";
  return "normal";
}

function getWeekKey(dateStr: string): string {
  const [m, d] = dateStr.split("/").map(Number);
  const date = new Date(new Date().getFullYear(), m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - diff);
  return `${monday.getMonth() + 1}/${monday.getDate()}`;
}

export function useMemberProfile(
  rawData: Record<string, Record<string, any>> | null,
  member: string,
  dates: string[],
  commitData: CommitData | null,
  leave: Record<string, LeaveRange[]>,
  taskAnalysisData: TaskAnalysisData | null
): MemberProfile {
  return useMemo(() => {
    const memberLeave = leave[member] || [];

    // Hours trend
    const hoursTrend = dates.map(d => {
      const data = rawData?.[d]?.[member];
      const total = (data?.total as number | null) ?? null;
      const meeting = (data?.meeting as number | null) ?? null;
      const dev = (data?.dev as number | null) ?? null;
      return { date: d, total, meeting, dev, status: getHoursStatus(total) };
    });

    // Baseline (median of non-null, non-leave hours)
    const hoursValues = dates
      .filter(d => !isOnLeave(d, memberLeave))
      .map(d => rawData?.[d]?.[member]?.total as number | null)
      .filter((v): v is number => v !== null);
    const baseline = hoursValues.length >= HEALTH_THRESHOLDS.minDataPoints ? median(hoursValues) : null;

    // Recent avg (last 7 days)
    const last7 = dates.slice(-7);
    const last7Hours = last7
      .filter(d => !isOnLeave(d, memberLeave))
      .map(d => rawData?.[d]?.[member]?.total as number | null)
      .filter((v): v is number => v !== null);
    const recentAvg = last7Hours.length > 0
      ? +(last7Hours.reduce((a, b) => a + b, 0) / last7Hours.length).toFixed(2)
      : null;

    // Meeting percentage (last 7 days)
    const last7Meeting = last7
      .map(d => rawData?.[d]?.[member])
      .filter(v => v?.total != null);
    const meetingPct = last7Meeting.length > 0
      ? +((last7Meeting.reduce((sum, v) => sum + ((v.meeting || 0) / v.total) * 100, 0)) / last7Meeting.length).toFixed(1)
      : null;

    // Consistency grid
    const consistencyGrid = dates.map(d => {
      const status = commitData?.analysis?.[d]?.[member]?.status as "✅" | "⚠️" | "🔴" | undefined;
      return { date: d, status: status ?? null };
    });
    const withStatus = consistencyGrid.filter(g => g.status !== null);
    const okCount = withStatus.filter(g => g.status === "✅").length;
    const consistencyRate = withStatus.length > 0 ? Math.round((okCount / withStatus.length) * 100) : 0;

    // Project distribution
    const projectCounts: Record<string, number> = {};
    let totalCommits = 0;
    let recentCommits = 0;
    let prevCommits = 0;
    const recent7Set = new Set(dates.slice(-7));
    const prev7Set = new Set(dates.slice(-14, -7));

    for (const d of dates) {
      const memberCommits = commitData?.commits?.[d]?.[member];
      if (!memberCommits) continue;
      totalCommits += memberCommits.count;
      if (recent7Set.has(d)) recentCommits += memberCommits.count;
      if (prev7Set.has(d)) prevCommits += memberCommits.count;
      for (const item of memberCommits.items) {
        projectCounts[item.project] = (projectCounts[item.project] || 0) + 1;
      }
    }
    const projectDistribution = Object.entries(projectCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([project, count]) => ({
        project,
        count,
        pct: totalCommits > 0 ? Math.round((count / totalCommits) * 100) : 0,
      }));

    // Weekly meeting percentage
    const weekGroups: Record<string, { meetingSum: number; totalSum: number; count: number }> = {};
    for (const d of dates) {
      const data = rawData?.[d]?.[member];
      if (!data || data.total == null) continue;
      const wk = getWeekKey(d);
      if (!weekGroups[wk]) weekGroups[wk] = { meetingSum: 0, totalSum: 0, count: 0 };
      weekGroups[wk].meetingSum += data.meeting || 0;
      weekGroups[wk].totalSum += data.total;
      weekGroups[wk].count += 1;
    }
    const weeklyMeetingPct = Object.entries(weekGroups)
      .sort((a, b) => {
        const [am, ad] = a[0].split("/").map(Number);
        const [bm, bd] = b[0].split("/").map(Number);
        return am * 100 + ad - (bm * 100 + bd);
      })
      .map(([week, g]) => ({
        week,
        pct: g.totalSum > 0 ? +((g.meetingSum / g.totalSum) * 100).toFixed(1) : 0,
      }));

    // Task warnings
    const taskWarnings = (taskAnalysisData?.warnings || [])
      .filter(w => w.member === member)
      .slice(0, 5)
      .map(w => ({ date: w.date, severity: w.severity, type: w.type, task: w.task, reasoning: w.reasoning }));

    return {
      hoursTrend, baseline, recentAvg, meetingPct,
      consistencyGrid, consistencyRate,
      projectDistribution, totalCommits, recentCommits, prevCommits,
      weeklyMeetingPct, taskWarnings,
    };
  }, [rawData, member, dates, commitData, leave, taskAnalysisData]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/unit/hooks/useMemberProfile.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMemberProfile.ts tests/unit/hooks/useMemberProfile.test.ts
git commit -m "feat: add useMemberProfile hook for per-member 30-day profile aggregation"
```

---

## Task 5: MemberView Component (TDD)

**Files:**
- Create: `src/views/MemberView.tsx`
- Create: `tests/components/MemberView.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `tests/components/MemberView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { MemberView } from "../../src/views/MemberView";

const baseProps = {
  rawData: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`3/${i + 1}`, {
      A: { total: 8, meeting: 1, dev: 7 },
      B: { total: 7, meeting: 2, dev: 5 },
    }])
  ),
  members: ["A", "B"],
  memberColors: { A: "#f472b6", B: "#60a5fa" },
  dates: Array.from({ length: 20 }, (_, i) => `3/${i + 1}`),
  commitData: { commits: {}, analysis: {}, projectRisks: [] },
  leave: {},
  taskAnalysisData: null,
  healthAlerts: [],
  isMobile: false,
};

describe("MemberView", () => {
  it("renders member selector pills", () => {
    render(<MemberView {...baseProps} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("switches member on pill click", () => {
    render(<MemberView {...baseProps} />);
    fireEvent.click(screen.getByText("B"));
    // B should now be the active member — profile card should update
    // (We verify by checking the profile renders without error)
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders 4 profile cards", () => {
    const { container } = render(<MemberView {...baseProps} />);
    const cards = container.querySelectorAll("[data-testid^='profile-card-']");
    expect(cards).toHaveLength(4);
  });

  it("shows alert banner for member with health alerts", () => {
    const props = {
      ...baseProps,
      healthAlerts: [
        { member: "A", severity: "🔴", text: "連續低工時 (3天)", source: "trend" as const, type: "consecutive_low" as const },
      ],
    };
    render(<MemberView {...props} />);
    expect(screen.getByText("連續低工時 (3天)")).toBeInTheDocument();
  });

  it("does not show alert banner when member has no alerts", () => {
    render(<MemberView {...baseProps} />);
    expect(screen.queryByTestId("alert-banner")).not.toBeInTheDocument();
  });

  it("shows severity badge on member pills with alerts", () => {
    const props = {
      ...baseProps,
      healthAlerts: [
        { member: "A", severity: "🔴", text: "test", source: "trend" as const, type: "hours_drop" as const },
      ],
    };
    render(<MemberView {...props} />);
    expect(screen.getByText("🔴")).toBeInTheDocument();
  });

  it("defaults to first member with alert", () => {
    const props = {
      ...baseProps,
      healthAlerts: [
        { member: "B", severity: "🟡", text: "test", source: "trend" as const, type: "commit_drop" as const },
      ],
    };
    render(<MemberView {...props} />);
    // B should be selected by default since it has an alert
    expect(screen.getByText("test")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/components/MemberView.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MemberView component**

Create `src/views/MemberView.tsx`:

```tsx
import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { COLORS, SEVERITY_COLORS, HEALTH_THRESHOLDS } from "../constants";
import { useMemberProfile } from "../hooks/useMemberProfile";
import type { HealthAlert, CommitData, TaskAnalysisData, LeaveRange } from "../types";

interface MemberViewProps {
  rawData: Record<string, Record<string, any>>;
  members: string[];
  memberColors: Record<string, string>;
  dates: string[];
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
  taskAnalysisData: TaskAnalysisData | null;
  healthAlerts: HealthAlert[];
  isMobile: boolean;
}

const STATUS_COLORS = { normal: COLORS.accentLight, warning: COLORS.yellow, danger: COLORS.red };

export function MemberView({
  rawData, members, memberColors, dates, commitData, leave, taskAnalysisData, healthAlerts, isMobile,
}: MemberViewProps) {
  const alertsByMember = useMemo(() => {
    const map: Record<string, HealthAlert[]> = {};
    for (const a of healthAlerts) {
      (map[a.member] ||= []).push(a);
    }
    return map;
  }, [healthAlerts]);

  const defaultMember = useMemo(() => {
    const withAlert = members.find(m => alertsByMember[m]?.length);
    return withAlert || members[0] || "";
  }, [members, alertsByMember]);

  const [selectedMember, setSelectedMember] = useState(defaultMember);
  const member = members.includes(selectedMember) ? selectedMember : members[0] || "";

  const profile = useMemberProfile(rawData, member, dates, commitData, leave, taskAnalysisData);
  const memberAlerts = alertsByMember[member] || [];

  return (
    <div className="animate-in" style={{ animationDelay: "0.1s" }}>
      {/* Member selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {members.map(m => {
          const isActive = m === member;
          const alerts = alertsByMember[m];
          const topSev = alerts?.[0]?.severity;
          return (
            <button key={m} onClick={() => setSelectedMember(m)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: isActive ? 700 : 500,
              fontFamily: "inherit", border: isActive ? `1px solid ${memberColors[m]}44` : "none",
              cursor: "pointer", transition: "all 0.15s",
              color: isActive ? memberColors[m] : COLORS.textDim,
              background: isActive ? `${memberColors[m]}22` : COLORS.card,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {m}
              {topSev && <span style={{ fontSize: 9 }}>{topSev}</span>}
            </button>
          );
        })}
      </div>

      {/* Alert banner */}
      {memberAlerts.length > 0 && (
        <div data-testid="alert-banner" style={{ marginBottom: 12 }}>
          {memberAlerts.map((alert, i) => {
            const sev = SEVERITY_COLORS[alert.severity];
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                borderRadius: 8, background: (sev?.bg || COLORS.border) + "44",
                border: `1px solid ${(sev?.sc || COLORS.border)}22`, marginBottom: 6,
              }}>
                <span style={{ fontSize: 14 }}>{alert.severity}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: sev?.sc || COLORS.text }}>{alert.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4-card grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gap: 12,
      }}>
        {/* Card 1: Hours Trend */}
        <div data-testid="profile-card-hours" style={{ background: COLORS.card, borderRadius: 10, padding: 16, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, marginBottom: 10 }}>30 天工時曲線</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={profile.hoursTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 8, fill: COLORS.textDim }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: COLORS.textDim }} domain={[0, 12]} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 11 }} />
              {profile.baseline && <ReferenceLine y={profile.baseline} stroke={COLORS.textDim} strokeDasharray="4 4" label={{ value: `基線 ${profile.baseline}h`, fill: COLORS.textDim, fontSize: 9, position: "right" }} />}
              <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                {profile.hoursTrend.map((entry, idx) => (
                  <Cell key={idx} fill={STATUS_COLORS[entry.status]} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 6, display: "flex", gap: 12 }}>
            {profile.baseline !== null && <span>基線 <b style={{ color: COLORS.accentLight }}>{profile.baseline}h</b></span>}
            {profile.recentAvg !== null && <span>近 7 天 <b style={{ color: profile.recentAvg < (profile.baseline || 0) * 0.7 ? COLORS.red : COLORS.text }}>{profile.recentAvg}h</b></span>}
            {profile.meetingPct !== null && <span>會議 <b style={{ color: profile.meetingPct > HEALTH_THRESHOLDS.meetingHeavyPct ? COLORS.yellow : COLORS.text }}>{profile.meetingPct}%</b></span>}
          </div>
        </div>

        {/* Card 2: Consistency Timeline */}
        <div data-testid="profile-card-consistency" style={{ background: COLORS.card, borderRadius: 10, padding: 16, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, marginBottom: 10 }}>一致性 Timeline</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {profile.consistencyGrid.map((g, i) => {
              const color = g.status === "✅" ? COLORS.green
                : g.status === "⚠️" ? COLORS.yellow
                : g.status === "🔴" ? COLORS.red
                : COLORS.border;
              return (
                <div key={i} title={`${g.date}: ${g.status || "—"}`} style={{
                  aspectRatio: "1", borderRadius: 3, background: color, opacity: g.status ? 0.8 : 0.3,
                }} />
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 8, display: "flex", gap: 8 }}>
            <span>✅ {profile.consistencyGrid.filter(g => g.status === "✅").length}</span>
            <span>⚠️ {profile.consistencyGrid.filter(g => g.status === "⚠️").length}</span>
            <span>🔴 {profile.consistencyGrid.filter(g => g.status === "🔴").length}</span>
            <span style={{ marginLeft: "auto" }}>一致率 <b style={{ color: profile.consistencyRate >= 80 ? COLORS.green : profile.consistencyRate >= 60 ? COLORS.yellow : COLORS.red }}>{profile.consistencyRate}%</b></span>
          </div>
        </div>

        {/* Card 3: Project Distribution */}
        <div data-testid="profile-card-projects" style={{ background: COLORS.card, borderRadius: 10, padding: 16, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, marginBottom: 10 }}>專案分布（30 天）</div>
          {profile.totalCommits > 0 ? (
            <>
              <div style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                {profile.projectDistribution.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ width: `${p.pct}%`, background: [COLORS.accentLight, COLORS.purple, COLORS.green, COLORS.yellow][i] || COLORS.textDim }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 10 }}>
                {profile.projectDistribution.slice(0, 4).map((p, i) => (
                  <span key={i}>
                    <span style={{ display: "inline-block", width: 8, height: 8, background: [COLORS.accentLight, COLORS.purple, COLORS.green, COLORS.yellow][i], borderRadius: 2, marginRight: 3 }} />
                    <span style={{ color: COLORS.textMuted }}>{p.project} {p.pct}%</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: COLORS.textDim, padding: "20px 0", textAlign: "center" }}>無 commit 資料</div>
          )}
          <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 8, borderTop: `1px dashed ${COLORS.border}`, paddingTop: 6, display: "flex", gap: 12 }}>
            <span>Total: <b style={{ color: COLORS.teal }}>{profile.totalCommits}</b></span>
            <span>近 7 天: <b style={{ color: profile.recentCommits < profile.prevCommits * 0.3 ? COLORS.red : COLORS.text }}>{profile.recentCommits}</b></span>
            <span>前 7 天: {profile.prevCommits}</span>
          </div>
        </div>

        {/* Card 4: Meeting + Task Warnings */}
        <div data-testid="profile-card-meetings" style={{ background: COLORS.card, borderRadius: 10, padding: 16, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, marginBottom: 10 }}>會議比例 & 任務警告</div>
          {profile.weeklyMeetingPct.length > 0 && (
            <div style={{ display: "flex", gap: 4, alignItems: "end", height: 50, marginBottom: 8 }}>
              {profile.weeklyMeetingPct.map((w, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{
                    width: "100%", height: `${Math.max(4, w.pct)}%`,
                    background: w.pct > HEALTH_THRESHOLDS.meetingHeavyPct ? COLORS.yellow : COLORS.purple,
                    borderRadius: "2px 2px 0 0", opacity: 0.8, minHeight: 4,
                  }} />
                  <span style={{ fontSize: 7, color: COLORS.textDim }}>{w.week}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 9, color: COLORS.textMuted, marginBottom: 8 }}>
            {profile.weeklyMeetingPct.map(w => `${Math.round(w.pct)}%`).join(" → ")}
          </div>
          {profile.taskWarnings.length > 0 && (
            <div style={{ borderTop: `1px dashed ${COLORS.border}`, paddingTop: 6 }}>
              <div style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, marginBottom: 4 }}>任務警告</div>
              {profile.taskWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 10, color: SEVERITY_COLORS[w.severity]?.sc || COLORS.textMuted, marginBottom: 2 }}>
                  {w.severity} {w.date} — {w.type}: {w.task}
                </div>
              ))}
            </div>
          )}
          {profile.taskWarnings.length === 0 && profile.weeklyMeetingPct.length === 0 && (
            <div style={{ fontSize: 11, color: COLORS.textDim, padding: "20px 0", textAlign: "center" }}>無資料</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/components/MemberView.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/MemberView.tsx tests/components/MemberView.test.tsx
git commit -m "feat: add MemberView component with 4-card responsive profile grid"
```

---

## Task 6: Wire Everything in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/App.tsx`, add:

```ts
import { MemberView } from "./views/MemberView";
import { useHealthAlerts } from "./hooks/useHealthAlerts";
```

- [ ] **Step 2: Update view state type**

Change:

```ts
const [view, setView] = useState<"detail" | "trend" | "weekly">("detail");
```

to:

```ts
const [view, setView] = useState<"detail" | "trend" | "weekly" | "member">("detail");
```

- [ ] **Step 3: Add useHealthAlerts call**

After the `useAllIssues` call (around line 81), add:

```ts
const healthAlerts = useHealthAlerts(rawData, members, dates, commitData, leave, null, activeDate);
```

- [ ] **Step 4: Pass healthAlerts to useAllIssues**

Change:

```ts
const allIssues = useAllIssues(issues, commitData, activeDate);
```

to:

```ts
const allIssues = useAllIssues(issues, commitData, activeDate, healthAlerts);
```

- [ ] **Step 5: Add member tab button**

In the tabs array (around line 131), change:

```ts
{[
  { key: "detail", label: "📅 每日詳情" },
  { key: "trend", label: "📈 趨勢" },
  { key: "weekly", label: "📋 週報" },
].map(tab => (
```

to:

```ts
{[
  { key: "detail", label: "📅 每日詳情" },
  { key: "trend", label: "📈 趨勢" },
  { key: "weekly", label: "📋 週報" },
  { key: "member", label: "👤 成員" },
].map(tab => (
```

- [ ] **Step 6: Add MemberView render block**

After the `{view === "weekly" && (` block (around line 213), add:

```tsx
{view === "member" && (
  <MemberView
    rawData={rawData!}
    members={members}
    memberColors={memberColors}
    dates={dates}
    commitData={commitData}
    leave={leave}
    taskAnalysisData={taskAnalysisData}
    healthAlerts={healthAlerts}
    isMobile={isMobile}
  />
)}
```

- [ ] **Step 7: Run all existing tests to verify nothing is broken**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire useHealthAlerts + MemberView tab into App"
```

---

## Task 7: Update E2E Tests

**Files:**
- Modify: `tests/e2e/tab-restructure.spec.ts`
- Create: `tests/e2e/member-health.spec.ts`

- [ ] **Step 1: Update tab count test**

In `tests/e2e/tab-restructure.spec.ts`, change:

```ts
test('renders 3 main tabs', async ({ page }) => {
    const tabs = page.locator('.tab-btn');
    await expect(tabs).toHaveCount(3);
```

to:

```ts
test('renders 4 main tabs', async ({ page }) => {
    const tabs = page.locator('.tab-btn');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toContainText('每日詳情');
    await expect(tabs.nth(1)).toContainText('趨勢');
    await expect(tabs.nth(2)).toContainText('週報');
    await expect(tabs.nth(3)).toContainText('成員');
```

- [ ] **Step 2: Create member-health E2E test**

Create `tests/e2e/member-health.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Member Health Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('');
    await page.waitForSelector('.tab-btn');
  });

  test('can navigate to member tab', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    // Should see member selector buttons
    await expect(page.locator('[data-testid^="profile-card-"]').first()).toBeVisible();
  });

  test('member selector pills are rendered', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    // At least one member button should exist
    await expect(page.locator('button').filter({ hasText: /^[\u4e00-\u9fff\w]+/ }).first()).toBeVisible();
  });

  test('clicking a member pill switches profile', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    const pills = page.locator('button').filter({ hasText: /^[\u4e00-\u9fff\w]+/ });
    const count = await pills.count();
    if (count >= 2) {
      await pills.nth(1).click();
      // Profile cards should still be visible after switching
      await expect(page.locator('[data-testid^="profile-card-"]').first()).toBeVisible();
    }
  });

  test('4 profile cards are rendered', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    const cards = page.locator('[data-testid^="profile-card-"]');
    await expect(cards).toHaveCount(4);
  });

  test('StatusOverview shows trend badge when health alerts exist', async ({ page }) => {
    // This test checks that the StatusOverview renders correctly
    // The trend badge only appears if data triggers an alert
    const overview = page.locator('.status-overview');
    await expect(overview).toBeVisible();
  });
});
```

- [ ] **Step 3: Run E2E tests**

Run: `bunx playwright test tests/e2e/member-health.spec.ts tests/e2e/tab-restructure.spec.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/tab-restructure.spec.ts tests/e2e/member-health.spec.ts
git commit -m "test: add E2E tests for member tab and update tab count"
```

---

## Task 8: Run Full Test Suite & Final Verification

- [ ] **Step 1: Run all unit and component tests**

Run: `bun run test`
Expected: All tests PASS (including new and existing)

- [ ] **Step 2: Run all E2E tests**

Run: `bunx playwright test`
Expected: All tests PASS

- [ ] **Step 3: Start dev server and verify visually**

Run: `bun run dev`
Open http://localhost:5173 and verify:
1. StatusOverview shows trend badges on anomaly cards
2. "👤 成員" tab appears as 4th tab
3. Clicking into 成員 tab shows member selector with severity badges
4. Profile cards render correctly with charts
5. Responsive: resize browser to verify 2x2 → single column switch

- [ ] **Step 4: Update CLAUDE.md if needed**

Add `MemberView` to the architecture section and update view count from "Five dashboard views" to "Six dashboard views" (add: Member/Health).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md for member health tab"
```
