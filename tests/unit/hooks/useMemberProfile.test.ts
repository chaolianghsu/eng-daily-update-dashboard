// tests/unit/hooks/useMemberProfile.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMemberProfile } from "../../../src/hooks/useMemberProfile";
import type { CommitData, TaskAnalysisData, LeaveRange } from "../../../src/types";

// Helper to build minimal rawData
function makeRawData(entries: Record<string, Record<string, { total: number | null; meeting: number | null; dev: number | null }>>) {
  return entries;
}

// Helper to build minimal commitData
function makeCommitData(overrides: Partial<CommitData> = {}): CommitData {
  return {
    commits: {},
    analysis: {},
    projectRisks: [],
    ...overrides,
  };
}

// Helper to build minimal taskAnalysisData
function makeTaskAnalysisData(warnings: TaskAnalysisData["warnings"] = []): TaskAnalysisData {
  return {
    analysisDate: "2026-04-01",
    period: "3/1-3/31",
    warnings,
    summary: { totalWarnings: warnings.length, critical: 0, warning: 0, caution: 0 },
  };
}

describe("useMemberProfile", () => {
  const dates = ["3/1", "3/2", "3/3", "3/4", "3/5", "3/6", "3/7", "3/8", "3/9", "3/10"];
  const member = "Alice";

  describe("hoursTrend", () => {
    it("computes hoursTrend with correct status coloring", () => {
      const rawData = makeRawData({
        "3/1": { Alice: { total: 7, meeting: 1, dev: 6 } },   // normal (6.5-8.5)
        "3/2": { Alice: { total: 6, meeting: 1, dev: 5 } },   // warning (5-6.5)
        "3/3": { Alice: { total: 4, meeting: 0, dev: 4 } },   // danger (<5)
        "3/4": { Alice: { total: 9, meeting: 2, dev: 7 } },   // warning (8.5-10)
        "3/5": { Alice: { total: 11, meeting: 3, dev: 8 } },  // danger (>10)
        "3/6": { Alice: { total: null, meeting: null, dev: null } }, // danger (null)
        "3/7": { Alice: { total: 8, meeting: 2, dev: 6 } },   // normal
        "3/8": { Alice: { total: 5, meeting: 1, dev: 4 } },   // warning (exactly 5)
        "3/9": { Alice: { total: 6.5, meeting: 1, dev: 5.5 } }, // normal (exactly 6.5)
        "3/10": { Alice: { total: 8.5, meeting: 2, dev: 6.5 } }, // normal (exactly 8.5)
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, dates, makeCommitData(), {}, null)
      );

      const trend = result.current.hoursTrend;
      expect(trend).toHaveLength(10);
      expect(trend[0]).toEqual({ date: "3/1", total: 7, meeting: 1, dev: 6, status: "normal" });
      expect(trend[1].status).toBe("warning");   // 6 is in [5, 6.5)
      expect(trend[2].status).toBe("danger");     // 4 < 5
      expect(trend[3].status).toBe("warning");    // 9 is in (8.5, 10]
      expect(trend[4].status).toBe("danger");     // 11 > 10
      expect(trend[5].status).toBe("danger");     // null
      expect(trend[6].status).toBe("normal");     // 8
      expect(trend[7].status).toBe("warning");    // 5 (exactly boundary)
      expect(trend[8].status).toBe("normal");     // 6.5 (exactly boundary)
      expect(trend[9].status).toBe("normal");     // 8.5 (exactly boundary)
    });
  });

  describe("baseline", () => {
    it("computes baseline as median of available hours", () => {
      // 5 data points (minimum): 5, 6, 7, 8, 9 -> median = 7
      const rawData = makeRawData({
        "3/1": { Alice: { total: 9, meeting: 1, dev: 8 } },
        "3/2": { Alice: { total: 5, meeting: 1, dev: 4 } },
        "3/3": { Alice: { total: 7, meeting: 1, dev: 6 } },
        "3/4": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/5": { Alice: { total: 6, meeting: 1, dev: 5 } },
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, ["3/1", "3/2", "3/3", "3/4", "3/5"], makeCommitData(), {}, null)
      );

      expect(result.current.baseline).toBe(7);
    });

    it("returns null if fewer than minDataPoints", () => {
      const rawData = makeRawData({
        "3/1": { Alice: { total: 8, meeting: 1, dev: 7 } },
        "3/2": { Alice: { total: 7, meeting: 1, dev: 6 } },
        "3/3": { Alice: { total: null, meeting: null, dev: null } },
        "3/4": { Alice: { total: null, meeting: null, dev: null } },
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, ["3/1", "3/2", "3/3", "3/4"], makeCommitData(), {}, null)
      );

      // only 2 non-null values, less than minDataPoints (5)
      expect(result.current.baseline).toBeNull();
    });

    it("computes even-count median correctly", () => {
      // 6 data points: 5, 6, 7, 8, 9, 10 -> median = (7+8)/2 = 7.5
      const rawData = makeRawData({
        "3/1": { Alice: { total: 5, meeting: 1, dev: 4 } },
        "3/2": { Alice: { total: 10, meeting: 1, dev: 9 } },
        "3/3": { Alice: { total: 7, meeting: 1, dev: 6 } },
        "3/4": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/5": { Alice: { total: 6, meeting: 1, dev: 5 } },
        "3/6": { Alice: { total: 9, meeting: 2, dev: 7 } },
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, ["3/1", "3/2", "3/3", "3/4", "3/5", "3/6"], makeCommitData(), {}, null)
      );

      expect(result.current.baseline).toBe(7.5);
    });
  });

  describe("recentAvg", () => {
    it("computes recentAvg from last 7 days", () => {
      const rawData = makeRawData({
        "3/1": { Alice: { total: 1, meeting: 0, dev: 1 } },  // not in last 7
        "3/2": { Alice: { total: 2, meeting: 0, dev: 2 } },  // not in last 7
        "3/3": { Alice: { total: 3, meeting: 0, dev: 3 } },  // not in last 7
        "3/4": { Alice: { total: 6, meeting: 1, dev: 5 } },
        "3/5": { Alice: { total: 7, meeting: 1, dev: 6 } },
        "3/6": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/7": { Alice: { total: 9, meeting: 2, dev: 7 } },
        "3/8": { Alice: { total: 7, meeting: 1, dev: 6 } },
        "3/9": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/10": { Alice: { total: 6, meeting: 1, dev: 5 } },
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, dates, makeCommitData(), {}, null)
      );

      // last 7: 6+7+8+9+7+8+6 = 51, avg = 51/7 ≈ 7.3
      expect(result.current.recentAvg).toBeCloseTo(51 / 7, 1);
    });

    it("returns null when no hours in last 7 days", () => {
      const rawData = makeRawData({
        "3/1": { Alice: { total: 8, meeting: 1, dev: 7 } },
        "3/2": { Alice: { total: 7, meeting: 1, dev: 6 } },
      });
      // All last 7 dates have no data for Alice
      const allDates = ["3/1", "3/2", "3/3", "3/4", "3/5", "3/6", "3/7", "3/8", "3/9"];

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, allDates, makeCommitData(), {}, null)
      );

      // last 7 = 3/3..3/9, Alice has no data -> null
      expect(result.current.recentAvg).toBeNull();
    });
  });

  describe("consistencyGrid", () => {
    it("computes consistencyGrid from commitData.analysis", () => {
      const commitData = makeCommitData({
        analysis: {
          "3/1": { Alice: { status: "✅", commitCount: 3, hours: 8 } },
          "3/2": { Alice: { status: "⚠️", commitCount: 0, hours: 7 } },
          "3/3": { Alice: { status: "🔴", commitCount: 5, hours: null } },
          // 3/4 has no Alice entry
        },
      });

      const { result } = renderHook(() =>
        useMemberProfile({}, member, ["3/1", "3/2", "3/3", "3/4"], commitData, {}, null)
      );

      const grid = result.current.consistencyGrid;
      expect(grid).toHaveLength(4);
      expect(grid[0]).toEqual({ date: "3/1", status: "✅" });
      expect(grid[1]).toEqual({ date: "3/2", status: "⚠️" });
      expect(grid[2]).toEqual({ date: "3/3", status: "🔴" });
      expect(grid[3]).toEqual({ date: "3/4", status: null });
    });
  });

  describe("consistencyRate", () => {
    it("computes consistencyRate as percentage of check entries", () => {
      const commitData = makeCommitData({
        analysis: {
          "3/1": { Alice: { status: "✅", commitCount: 3, hours: 8 } },
          "3/2": { Alice: { status: "✅", commitCount: 2, hours: 7 } },
          "3/3": { Alice: { status: "⚠️", commitCount: 0, hours: 6 } },
          "3/4": { Alice: { status: "🔴", commitCount: 5, hours: null } },
        },
      });

      const { result } = renderHook(() =>
        useMemberProfile({}, member, ["3/1", "3/2", "3/3", "3/4"], commitData, {}, null)
      );

      // 2 ✅ out of 4 entries with status -> 50%
      expect(result.current.consistencyRate).toBe(50);
    });

    it("returns 0 when no analysis entries exist", () => {
      const { result } = renderHook(() =>
        useMemberProfile({}, member, ["3/1", "3/2"], makeCommitData(), {}, null)
      );

      expect(result.current.consistencyRate).toBe(0);
    });
  });

  describe("projectDistribution", () => {
    it("computes projectDistribution sorted by commit count", () => {
      const commitData = makeCommitData({
        commits: {
          "3/1": {
            Alice: {
              count: 5,
              projects: ["frontend", "backend", "frontend"],
              items: [
                { title: "fix A", sha: "a1", project: "frontend", url: "", source: "gitlab" },
                { title: "fix B", sha: "a2", project: "backend", url: "", source: "gitlab" },
                { title: "fix C", sha: "a3", project: "frontend", url: "", source: "gitlab" },
                { title: "fix D", sha: "a4", project: "frontend", url: "", source: "gitlab" },
                { title: "fix E", sha: "a5", project: "backend", url: "", source: "gitlab" },
              ],
            },
          },
          "3/2": {
            Alice: {
              count: 2,
              projects: ["backend"],
              items: [
                { title: "fix F", sha: "a6", project: "backend", url: "", source: "gitlab" },
                { title: "fix G", sha: "a7", project: "api", url: "", source: "github" },
              ],
            },
          },
        },
      });

      const { result } = renderHook(() =>
        useMemberProfile({}, member, ["3/1", "3/2"], commitData, {}, null)
      );

      const dist = result.current.projectDistribution;
      // backend: 3 commits, frontend: 3 commits, api: 1 commit = 7 total
      // sorted by count desc: backend=3, frontend=3 (tied), api=1
      expect(dist).toHaveLength(3);
      expect(dist[0].count).toBeGreaterThanOrEqual(dist[1].count);
      expect(dist[1].count).toBeGreaterThanOrEqual(dist[2].count);
      expect(dist[2]).toEqual({ project: "api", count: 1, pct: expect.closeTo(100 / 7, 0) });
      // total pcts should sum to ~100
      const totalPct = dist.reduce((s, d) => s + d.pct, 0);
      expect(totalPct).toBeCloseTo(100, 0);
    });
  });

  describe("totalCommits, recentCommits, prevCommits", () => {
    it("counts total, recent (last 7), and prev (7-14 days ago) commits", () => {
      // dates: 3/1..3/14 (14 days)
      const allDates = Array.from({ length: 14 }, (_, i) => `3/${i + 1}`);
      const commitData = makeCommitData({
        commits: {
          "3/2": { Alice: { count: 2, projects: ["a"], items: [
            { title: "x", sha: "s1", project: "a", url: "", source: "gitlab" },
            { title: "y", sha: "s2", project: "a", url: "", source: "gitlab" },
          ] } },
          "3/5": { Alice: { count: 1, projects: ["b"], items: [
            { title: "z", sha: "s3", project: "b", url: "", source: "gitlab" },
          ] } },
          "3/10": { Alice: { count: 3, projects: ["a"], items: [
            { title: "a", sha: "s4", project: "a", url: "", source: "gitlab" },
            { title: "b", sha: "s5", project: "a", url: "", source: "gitlab" },
            { title: "c", sha: "s6", project: "a", url: "", source: "gitlab" },
          ] } },
          "3/14": { Alice: { count: 1, projects: ["a"], items: [
            { title: "d", sha: "s7", project: "a", url: "", source: "gitlab" },
          ] } },
        },
      });

      const { result } = renderHook(() =>
        useMemberProfile({}, member, allDates, commitData, {}, null)
      );

      // total: 2+1+3+1 = 7
      expect(result.current.totalCommits).toBe(7);
      // last 7 dates: 3/8..3/14 -> 3 (3/10) + 1 (3/14) = 4
      expect(result.current.recentCommits).toBe(4);
      // 7-14 days ago: 3/1..3/7 -> 2 (3/2) + 1 (3/5) = 3
      expect(result.current.prevCommits).toBe(3);
    });
  });

  describe("weeklyMeetingPct", () => {
    it("groups by week and calculates meeting/total percentage", () => {
      // Mon 3/2 to Fri 3/6 = one week, Mon 3/9 to 3/10 = partial second week
      const rawData = makeRawData({
        "3/2": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/3": { Alice: { total: 8, meeting: 4, dev: 4 } },
        "3/4": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/5": { Alice: { total: 8, meeting: 0, dev: 8 } },
        "3/6": { Alice: { total: 8, meeting: 2, dev: 6 } },
        "3/9": { Alice: { total: 10, meeting: 5, dev: 5 } },
        "3/10": { Alice: { total: 10, meeting: 5, dev: 5 } },
      });
      // Note: 3/1 is a Saturday in 2026, skip it for clean week grouping
      const weekDates = ["3/2", "3/3", "3/4", "3/5", "3/6", "3/9", "3/10"];

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, weekDates, makeCommitData(), {}, null)
      );

      const wmp = result.current.weeklyMeetingPct;
      expect(wmp.length).toBeGreaterThanOrEqual(2);
      // Week 1 (3/2-3/6): meetings = 2+4+2+0+2 = 10, total = 40, pct = 25
      expect(wmp[0].pct).toBeCloseTo(25, 0);
      // Week 2 (3/9-3/10): meetings = 5+5 = 10, total = 20, pct = 50
      expect(wmp[1].pct).toBeCloseTo(50, 0);
    });
  });

  describe("taskWarnings", () => {
    it("filters taskWarnings for the selected member only, max 5", () => {
      const warnings = [
        { date: "3/1", member: "Alice", severity: "🔴", type: "low_output", task: "t1", commits: "c1", reasoning: "r1" },
        { date: "3/2", member: "Bob", severity: "🟡", type: "mismatch", task: "t2", commits: "c2", reasoning: "r2" },
        { date: "3/3", member: "Alice", severity: "🟡", type: "mismatch", task: "t3", commits: "c3", reasoning: "r3" },
        { date: "3/4", member: "Alice", severity: "🟠", type: "outlier", task: "t4", commits: "c4", reasoning: "r4" },
        { date: "3/5", member: "Alice", severity: "🔴", type: "low_output", task: "t5", commits: "c5", reasoning: "r5" },
        { date: "3/6", member: "Alice", severity: "🟡", type: "mismatch", task: "t6", commits: "c6", reasoning: "r6" },
        { date: "3/7", member: "Alice", severity: "🟠", type: "outlier", task: "t7", commits: "c7", reasoning: "r7" },
      ];
      const taskData = makeTaskAnalysisData(warnings);

      const { result } = renderHook(() =>
        useMemberProfile({}, member, dates, makeCommitData(), {}, taskData)
      );

      // Alice has 6 warnings, should be capped at 5
      expect(result.current.taskWarnings).toHaveLength(5);
      result.current.taskWarnings.forEach(w => {
        expect(w).not.toHaveProperty("member");
        expect(w).not.toHaveProperty("commits");
      });
    });
  });

  describe("unknown member", () => {
    it("returns empty profile for unknown member", () => {
      const rawData = makeRawData({
        "3/1": { Alice: { total: 8, meeting: 1, dev: 7 } },
        "3/2": { Alice: { total: 7, meeting: 1, dev: 6 } },
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, "Unknown", ["3/1", "3/2"], makeCommitData(), {}, null)
      );

      const profile = result.current;
      expect(profile.hoursTrend).toHaveLength(2);
      expect(profile.hoursTrend.every(h => h.total === null)).toBe(true);
      expect(profile.baseline).toBeNull();
      expect(profile.recentAvg).toBeNull();
      expect(profile.consistencyGrid).toHaveLength(2);
      expect(profile.consistencyRate).toBe(0);
      expect(profile.projectDistribution).toEqual([]);
      expect(profile.totalCommits).toBe(0);
      expect(profile.recentCommits).toBe(0);
      expect(profile.prevCommits).toBe(0);
      expect(profile.weeklyMeetingPct).toEqual([]);
      expect(profile.taskWarnings).toEqual([]);
    });
  });

  describe("leave filtering", () => {
    it("excludes leave days from baseline calculation", () => {
      const rawData = makeRawData({
        "3/1": { Alice: { total: 7, meeting: 1, dev: 6 } },
        "3/2": { Alice: { total: 8, meeting: 1, dev: 7 } },
        "3/3": { Alice: { total: 6, meeting: 0, dev: 6 } },
        "3/4": { Alice: { total: 9, meeting: 2, dev: 7 } },
        "3/5": { Alice: { total: 5, meeting: 1, dev: 4 } },
        "3/6": { Alice: { total: 4, meeting: 0, dev: 4 } }, // on leave
      });
      const leave: Record<string, LeaveRange[]> = {
        Alice: [{ start: "3/6", end: "3/6" }],
      };

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, ["3/1", "3/2", "3/3", "3/4", "3/5", "3/6"], makeCommitData(), leave, null)
      );

      // Without leave exclusion: sorted [4,5,6,7,8,9] median = (6+7)/2 = 6.5
      // With leave exclusion (3/6 removed): sorted [5,6,7,8,9] median = 7
      expect(result.current.baseline).toBe(7);
    });
  });

  describe("meetingPct", () => {
    it("computes average meeting percentage of last 7 days", () => {
      const rawData = makeRawData({
        "3/4": { Alice: { total: 8, meeting: 4, dev: 4 } },   // 50%
        "3/5": { Alice: { total: 10, meeting: 2, dev: 8 } },  // 20%
        "3/6": { Alice: { total: 8, meeting: 2, dev: 6 } },   // 25%
        "3/7": { Alice: { total: 8, meeting: 4, dev: 4 } },   // 50%
        "3/8": { Alice: { total: 6, meeting: 3, dev: 3 } },   // 50%
        "3/9": { Alice: { total: 8, meeting: 2, dev: 6 } },   // 25%
        "3/10": { Alice: { total: 10, meeting: 5, dev: 5 } },  // 50%
      });

      const { result } = renderHook(() =>
        useMemberProfile(rawData, member, dates, makeCommitData(), {}, null)
      );

      // last 7 dates: 3/4..3/10
      // meeting totals: 4+2+2+4+3+2+5 = 22, total hours: 8+10+8+8+6+8+10 = 58
      // meetingPct = 22/58 * 100 ≈ 37.9
      expect(result.current.meetingPct).toBeCloseTo(22 / 58 * 100, 0);
    });
  });
});
