# Commits Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate commits data into WeeklyView and TrendView tables, move consistency heatmap from CommitsView to WeeklyView.

**Architecture:** Extend `useWeeklySummary` hook with commit stats, add commit columns to TrendView's inline table computation, move heatmap JSX from CommitsView to WeeklyView, wire new props through App.tsx.

**Tech Stack:** React 18, TypeScript, Recharts, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-commits-integration-design.md`

---

### Task 1: Extend useWeeklySummary with commit stats

**Files:**
- Modify: `src/hooks/useWeeklySummary.ts`
- Test: `tests/unit/hooks/useWeeklySummary.test.ts`

- [ ] **Step 1: Write failing tests for commit fields**

Add to `tests/unit/hooks/useWeeklySummary.test.ts`:

```ts
it("calculates commit stats when commitData provided", () => {
  const rawData = {
    "3/5": { "A": { total: 8, meeting: 2, dev: 6 } },
    "3/6": { "A": { total: 7, meeting: 1, dev: 6 } },
  };
  const commitData = {
    commits: {
      "3/5": { "A": { count: 5, projects: ["p1"], items: [] } },
      "3/6": { "A": { count: 3, projects: ["p1"], items: [] } },
    },
    analysis: {
      "3/5": { "A": { status: "✅", commitCount: 5, hours: 8 } },
      "3/6": { "A": { status: "⚠️", commitCount: 3, hours: 7 } },
    },
    projectRisks: [],
  };
  const { result } = renderHook(() =>
    useWeeklySummary(rawData, ["3/5", "3/6"], ["A"], commitData)
  );
  expect(result.current[0].commitTotal).toBe(8);
  expect(result.current[0].commitAvg).toBe(4); // 8 / 2 active days
  expect(result.current[0].consistency).toEqual({ ok: 1, warn: 1, red: 0 });
});

it("returns zero commit stats when commitData is null", () => {
  const rawData = {
    "3/5": { "A": { total: 8, meeting: 2, dev: 6 } },
  };
  const { result } = renderHook(() =>
    useWeeklySummary(rawData, ["3/5"], ["A"], null)
  );
  expect(result.current[0].commitTotal).toBe(0);
  expect(result.current[0].commitAvg).toBe(0);
  expect(result.current[0].consistency).toEqual({ ok: 0, warn: 0, red: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/unit/hooks/useWeeklySummary.test.ts`
Expected: FAIL — `useWeeklySummary` doesn't accept 4th argument, no `commitTotal` field.

- [ ] **Step 3: Implement commit stats in useWeeklySummary**

Modify `src/hooks/useWeeklySummary.ts`:

1. Add import: `import type { CommitData } from "../types";`
2. Add 4th parameter: `commitData: CommitData | null = null`
3. Inside the `members.map()`, after existing calculations, add:

```ts
// Commit stats
let commitTotal = 0, commitDays = 0;
const consistency = { ok: 0, warn: 0, red: 0 };
if (commitData) {
  for (const d of dates) {
    const c = commitData.commits?.[d]?.[m];
    if (c && c.count > 0) { commitTotal += c.count; commitDays++; }
    const a = commitData.analysis?.[d]?.[m];
    if (a) {
      if (a.status === '✅') consistency.ok++;
      else if (a.status === '⚠️') consistency.warn++;
      else if (a.status === '🔴') consistency.red++;
    }
  }
}
const commitAvg = commitDays > 0 ? +((commitTotal / commitDays).toFixed(1)) : 0;
```

4. Add to return object: `commitTotal, commitAvg, consistency`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/unit/hooks/useWeeklySummary.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWeeklySummary.ts tests/unit/hooks/useWeeklySummary.test.ts
git commit -m "feat: add commit stats to useWeeklySummary hook"
```

---

### Task 2: Add commit columns to WeeklyView table

**Files:**
- Modify: `src/views/WeeklyView.tsx`
- Modify: `src/App.tsx:73,150-153`
- Test: `tests/components/WeeklyView.test.tsx`

- [ ] **Step 1: Write failing test for commit columns**

Add to `tests/components/WeeklyView.test.tsx`:

```ts
it("renders commit columns when commit data present", () => {
  const props = {
    ...baseProps,
    weeklySummary: [
      { ...baseProps.weeklySummary[0], commitTotal: 31, commitAvg: 6.2, consistency: { ok: 5, warn: 0, red: 0 } },
    ],
  };
  render(<WeeklyView {...props} />);
  expect(screen.getByText("Commits")).toBeInTheDocument();
  expect(screen.getByText("31")).toBeInTheDocument();
  expect(screen.getByText("6.2")).toBeInTheDocument();
});
```

Update `baseProps.weeklySummary[0]` to include new fields with zero defaults:
```ts
{ ...existing, commitTotal: 0, commitAvg: 0, consistency: { ok: 0, warn: 0, red: 0 } },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/components/WeeklyView.test.tsx`
Expected: FAIL — no "Commits" header rendered.

- [ ] **Step 3: Add commit columns to WeeklyView table**

Modify `src/views/WeeklyView.tsx`:

1. Update `WeeklySummaryEntry` interface — add:
```ts
commitTotal: number;
commitAvg: number;
consistency: { ok: number; warn: number; red: number };
```

2. Update table headers array (line 72). Replace:
```ts
{["成員", "回報", "總工時", "日均", "會議", "會議%", "穩定度", "趨勢"].map((h, i) => (
```
With:
```ts
{["成員", "回報", "總工時", "日均", "會議%", "穩定度", "Commits", "日均C", "一致性", "趨勢"].map((h, i) => {
  const isTeal = h === "Commits" || h === "日均C" || h === "一致性";
  const tealIdx = ["Commits", "日均C", "一致性"].indexOf(h);
  return (
    <th key={h} style={{
      textAlign: h === "成員" ? "left" : "center", padding: "10px 8px",
      borderBottom: `1px solid ${COLORS.border}`,
      color: isTeal ? COLORS.teal : COLORS.textMuted,
      fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
      borderLeft: tealIdx === 0 ? `2px solid ${COLORS.tealDim}` : undefined,
      ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}),
    }}>{h}</th>
  );
})}
```

3. In `<tbody>`, after the 穩定度 `<td>` and before the 趨勢 `<td>`, insert three new cells:

```tsx
<td style={{ textAlign: "center", padding: "9px 8px", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: m.commitTotal > 0 ? COLORS.teal : COLORS.textDim, borderBottom: `1px solid ${COLORS.border}15`, borderLeft: `2px solid ${COLORS.tealDim}` }}>
  {m.commitTotal > 0 ? m.commitTotal : "—"}
</td>
<td style={{ textAlign: "center", padding: "9px 8px", fontVariantNumeric: "tabular-nums", color: m.commitAvg > 0 ? COLORS.teal : COLORS.textDim, borderBottom: `1px solid ${COLORS.border}15` }}>
  {m.commitAvg > 0 ? m.commitAvg : "—"}
</td>
<td style={{ textAlign: "center", padding: "9px 8px", fontSize: 11, borderBottom: `1px solid ${COLORS.border}15`, whiteSpace: "nowrap" }}>
  {(m.consistency.ok + m.consistency.warn + m.consistency.red) > 0 ? (
    <span>
      {m.consistency.ok > 0 && <span style={{ color: COLORS.green }}>✅{m.consistency.ok}</span>}
      {m.consistency.ok > 0 && m.consistency.warn > 0 && ' '}
      {m.consistency.warn > 0 && <span style={{ color: COLORS.yellow }}>⚠️{m.consistency.warn}</span>}
      {(m.consistency.ok > 0 || m.consistency.warn > 0) && m.consistency.red > 0 && ' '}
      {m.consistency.red > 0 && <span style={{ color: COLORS.red }}>🔴{m.consistency.red}</span>}
    </span>
  ) : <span style={{ color: COLORS.textDim }}>—</span>}
</td>
```

4. Remove the standalone 會議 `<td>` (meetSum column) — merge into 會議%:
   - The original headers had both "會議" (meetSum) and "會議%" (meetPct) — drop "會議" to keep the table width manageable after adding 3 commit columns. meetPct already conveys the key info.

- [ ] **Step 4: Update App.tsx to pass commitData to useWeeklySummary**

In `src/App.tsx` line 73, change:
```ts
const weeklySummary = useWeeklySummary(rawData, dates, members);
```
To:
```ts
const weeklySummary = useWeeklySummary(rawData, dates, members, commitData);
```

- [ ] **Step 5: Run tests**

Run: `bun run test tests/components/WeeklyView.test.tsx tests/unit/hooks/useWeeklySummary.test.ts`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/WeeklyView.tsx src/App.tsx tests/components/WeeklyView.test.tsx
git commit -m "feat: add Commits/consistency columns to WeeklyView table"
```

---

### Task 3: Add commit columns to TrendView aggregation table

**Files:**
- Modify: `src/views/TrendView.tsx`
- Test: `tests/components/TrendView.test.tsx`

- [ ] **Step 1: Write failing test**

Add to `tests/components/TrendView.test.tsx` — update `baseProps` to include `commitData`:
```ts
it("renders commit columns in weekly aggregation table", () => {
  const props = {
    ...baseProps,
    commitData: {
      commits: { "3/9": { "A": { count: 5, projects: ["p1"], items: [] } } },
      analysis: { "3/9": { "A": { status: "✅", commitCount: 5, hours: 8 } } },
      projectRisks: [],
    },
    useWeeklyAgg: true,
    weekGroups: [{ key: "3/9", label: "3/9–3/13", dates: ["3/9"] }],
  };
  render(<TrendView {...props} />);
  expect(screen.getByText("Commits")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test tests/components/TrendView.test.tsx`
Expected: FAIL — no "Commits" header.

- [ ] **Step 3: Add commit columns to both weekly and daily aggregation tables**

In `src/views/TrendView.tsx`:

**Weekly aggregation table (line ~143):** Update headers from:
```ts
{["成員", ...weekGroups.map((w: any) => w.label), "平均", "穩定度", ""].map(...)
```
To:
```ts
{["成員", ...weekGroups.map((w: any) => w.label), "平均", "穩定度", "Commits", "一致✅", ""].map((h, i) => {
  const isTeal = h === "Commits" || h === "一致✅";
  return (
    <th key={i} style={{
      textAlign: i === 0 ? "left" : "center", padding: "8px 8px",
      borderBottom: `1px solid ${COLORS.border}`,
      color: isTeal ? COLORS.teal : COLORS.textMuted,
      fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
      borderLeft: h === "Commits" ? `2px solid ${COLORS.tealDim}` : undefined,
      ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}),
    }}>{h}</th>
  );
})}
```

For each member row, after the stabilityPct `<td>` and before the trend `<td>`, compute and insert:
```tsx
{(() => {
  let ct = 0, okCount = 0, totalAnalysis = 0;
  if (commitData) {
    for (const d of trendDates) {
      const c = commitData.commits?.[d]?.[m];
      if (c) ct += c.count;
      const a = commitData.analysis?.[d]?.[m];
      if (a) { totalAnalysis++; if (a.status === '✅') okCount++; }
    }
  }
  const pct = totalAnalysis > 0 ? Math.round(okCount / totalAnalysis * 100) : null;
  return (
    <>
      <td style={{ textAlign: "center", padding: "7px 8px", fontVariantNumeric: "tabular-nums", color: ct > 0 ? COLORS.teal : COLORS.textDim, fontWeight: 700, borderBottom: `1px solid ${COLORS.border}15`, borderLeft: `2px solid ${COLORS.tealDim}` }}>
        {ct > 0 ? ct : "—"}
      </td>
      <td style={{ textAlign: "center", padding: "7px 8px", borderBottom: `1px solid ${COLORS.border}15` }}>
        {pct !== null ? <span style={{ color: COLORS.green, fontWeight: 700 }}>{pct}%</span> : <span style={{ color: COLORS.textDim }}>—</span>}
      </td>
    </>
  );
})()}
```

Update the 團隊平均 row's colSpan from 3 to 5.

**Daily aggregation table (line ~227):** Apply the same pattern — add "Commits" and "一致✅" headers, compute per-member commit totals and consistency % for `trendDates`, update 團隊平均 colSpan.

- [ ] **Step 4: Run tests**

Run: `bun run test tests/components/TrendView.test.tsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/TrendView.tsx tests/components/TrendView.test.tsx
git commit -m "feat: add Commits/consistency columns to TrendView tables"
```

---

### Task 4: Move consistency heatmap from CommitsView to WeeklyView

**Files:**
- Modify: `src/views/WeeklyView.tsx`
- Modify: `src/CommitsView.tsx`
- Modify: `src/App.tsx:150-153`

- [ ] **Step 1: Add new props to WeeklyView**

Update `WeeklyViewProps` interface in `src/views/WeeklyView.tsx`:
```ts
interface WeeklyViewProps {
  weeklySummary: WeeklySummaryEntry[];
  chartHeight: number;
  members: string[];
  memberColors: Record<string, string>;
  selectedMembers: Set<string>;
  onToggleMember: (name: string) => void;
  isMobile: boolean;
  dates: string[];
  // New props for heatmap
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
  dailyDates: string[];
  dayLabels: Record<string, string>;
  onDateSelectAndSwitchToCommits: (d: string) => void;
}
```

Add imports:
```ts
import type { CommitData, LeaveRange } from "../types";
import { COLORS } from "../constants";
```

- [ ] **Step 2: Copy heatmap JSX from CommitsView to WeeklyView**

From `src/CommitsView.tsx`, cut the entire `{/* Consistency Grid — cross-date overview */}` CardPanel block (the one at the bottom of the component).

Paste it into `src/views/WeeklyView.tsx` as the third `<div className="animate-in">` block, after the table CardPanel.

Changes when pasting:
- Replace `onDateSelect(d)` with `onDateSelectAndSwitchToCommits(d)` in all `onClick` handlers
- Replace `activeDate` references with a local variable (no active date highlighting in WeeklyView — remove the active date styling since there's no date selector in this tab)
- Title: change from `"一致性檢查（每日明細）"` to `"一致性總覽（全期間）"`
- Use `commitData.analysis` and `commitData.commits` from the new prop
- Compute `gridDates` locally: `const gridDates = dates.filter(d => commitData?.analysis?.[d]);`
- Wrap entire block in `{commitData && (...)}` guard

- [ ] **Step 3: Remove heatmap from CommitsView**

In `src/CommitsView.tsx`, delete the entire `{/* Consistency Grid — cross-date overview */}` CardPanel block and its contents (the block that was added at the bottom in the previous conversation).

- [ ] **Step 4: Update App.tsx to pass new props to WeeklyView**

In `src/App.tsx`, add `onDateSelectAndSwitchToCommits` handler after `toggleMember`:
```ts
const dateSelectAndSwitchToCommits = (d: string) => {
  setSelectedDate(d);
  setView('commits');
};
```

Update WeeklyView rendering (line ~150-153):
```tsx
{view === "weekly" && (
  <WeeklyView weeklySummary={weeklySummary} chartHeight={chartHeight}
    members={members} memberColors={memberColors} selectedMembers={selectedMembers}
    onToggleMember={toggleMember} isMobile={isMobile} dates={dates}
    commitData={commitData} leave={leave}
    dailyDates={dailyDates} dayLabels={dayLabels}
    onDateSelectAndSwitchToCommits={dateSelectAndSwitchToCommits} />
)}
```

- [ ] **Step 5: Run all tests**

Run: `bun run test`
Expected: All 145+ tests PASS.

- [ ] **Step 6: Manual verification**

Run: `bun run dev` — open http://localhost:5173/eng-daily-update-dashboard/
- [ ] Weekly tab: verify heatmap appears below table
- [ ] Weekly tab: click a date cell in heatmap → should switch to Commits tab with that date selected
- [ ] Commits tab: verify heatmap is gone
- [ ] Weekly tab: verify commit columns show data in table

- [ ] **Step 7: Commit**

```bash
git add src/views/WeeklyView.tsx src/CommitsView.tsx src/App.tsx
git commit -m "feat: move consistency heatmap from CommitsView to WeeklyView"
```

---

### Task 5: Final integration test and cleanup

**Files:**
- Test: `tests/components/WeeklyView.test.tsx`

- [ ] **Step 1: Add heatmap rendering test**

```ts
it("renders consistency heatmap when commitData provided", () => {
  const props = {
    ...baseProps,
    commitData: {
      commits: { "3/9": { "A": { count: 5, projects: ["p1"], items: [] } } },
      analysis: { "3/9": { "A": { status: "✅", commitCount: 5, hours: 8 } } },
      projectRisks: [],
    },
    leave: {},
    dailyDates: ["3/9"],
    dayLabels: { "3/9": "一" },
    onDateSelectAndSwitchToCommits: vi.fn(),
  };
  render(<WeeklyView {...props} />);
  expect(screen.getByText("一致性總覽（全期間）")).toBeInTheDocument();
});
```

Update `baseProps` to include the new required props with safe defaults:
```ts
commitData: null,
leave: {},
dailyDates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
dayLabels: { "3/9": "一", "3/10": "二", "3/11": "三", "3/12": "四", "3/13": "五" },
onDateSelectAndSwitchToCommits: vi.fn(),
```

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/components/WeeklyView.test.tsx
git commit -m "test: add WeeklyView heatmap and commit column tests"
```
