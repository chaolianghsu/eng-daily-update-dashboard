// tests/unit/hooks/useHealthAlerts.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHealthAlerts } from "../../../src/hooks/useHealthAlerts";
import type { CommitData, TaskAnalysisData, LeaveRange } from "../../../src/types";

// Helper to build rawData with a single member over multiple dates
function buildRawData(
  entries: Array<{ date: string; member: string; total: number | null; meeting?: number | null; dev?: number | null }>
): Record<string, Record<string, { total: number | null; meeting: number | null; dev: number | null }>> {
  const rawData: Record<string, Record<string, { total: number | null; meeting: number | null; dev: number | null }>> = {};
  for (const e of entries) {
    if (!rawData[e.date]) rawData[e.date] = {};
    rawData[e.date][e.member] = {
      total: e.total,
      meeting: e.meeting ?? 0,
      dev: e.dev ?? (e.total !== null ? e.total - (e.meeting ?? 0) : null),
    };
  }
  return rawData;
}

function emptyCommitData(): CommitData {
  return { commits: {}, analysis: {}, projectRisks: [] };
}

describe("useHealthAlerts", () => {
  describe("Fixed threshold rules", () => {
    it("flags extreme low hours (< 4h) as 🔴", () => {
      const rawData = buildRawData([
        { date: "3/31", member: "Alice", total: 3 },
      ]);
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Alice"], ["3/31"], emptyCommitData(), {}, null, "3/31")
      );
      const alert = result.current.find(a => a.member === "Alice" && a.type === "low_hours");
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("🔴");
      expect(alert!.source).toBe("threshold");
    });

    it("flags extreme high hours (> 11h) as 🔴", () => {
      const rawData = buildRawData([
        { date: "3/31", member: "Bob", total: 12 },
      ]);
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Bob"], ["3/31"], emptyCommitData(), {}, null, "3/31")
      );
      const alert = result.current.find(a => a.member === "Bob" && a.type === "high_hours");
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("🔴");
      expect(alert!.source).toBe("threshold");
    });

    it("flags consecutive low hours (≥3 days < 6.5h) as 🔴", () => {
      const rawData = buildRawData([
        { date: "3/27", member: "Carol", total: 5 },
        { date: "3/28", member: "Carol", total: 6 },
        { date: "3/31", member: "Carol", total: 5.5 },
      ]);
      const dates = ["3/27", "3/28", "3/31"];
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Carol"], dates, emptyCommitData(), {}, null, "3/31")
      );
      const alert = result.current.find(a => a.member === "Carol" && a.type === "consecutive_low");
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("🔴");
    });

    it("flags meeting heavy (> 60%) as 🟡", () => {
      const rawData = buildRawData([
        { date: "3/31", member: "Dave", total: 8, meeting: 5.5, dev: 2.5 },
      ]);
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Dave"], ["3/31"], emptyCommitData(), {}, null, "3/31")
      );
      const alert = result.current.find(a => a.member === "Dave" && a.type === "meeting_heavy");
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("🟡");
    });

    it("excludes members on leave", () => {
      const rawData = buildRawData([
        { date: "3/31", member: "Eve", total: 2 },
      ]);
      const leave: Record<string, LeaveRange[]> = {
        Eve: [{ start: "3/31", end: "3/31" }],
      };
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Eve"], ["3/31"], emptyCommitData(), leave, null, "3/31")
      );
      const alerts = result.current.filter(a => a.member === "Eve");
      expect(alerts).toHaveLength(0);
    });
  });

  describe("Rolling baseline (MAD)", () => {
    it("flags hours drop when recent avg deviates from baseline", () => {
      // 17 days at 8h, then 3 days at 3h — median = 8, MAD ≈ 0, recent avg = 3
      // deviation = |3 - 8| = 5 >> 2 * adjusted MAD → should flag
      const entries: Array<{ date: string; member: string; total: number }> = [];
      for (let d = 1; d <= 17; d++) {
        entries.push({ date: `3/${d}`, member: "Frank", total: 8 });
      }
      entries.push({ date: "3/18", member: "Frank", total: 3 });
      entries.push({ date: "3/19", member: "Frank", total: 3 });
      entries.push({ date: "3/20", member: "Frank", total: 3 });
      const rawData = buildRawData(entries);
      const dates = entries.map(e => e.date);
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Frank"], dates, emptyCommitData(), {}, null, "3/20")
      );
      const alert = result.current.find(a => a.member === "Frank" && a.type === "hours_drop");
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("🟡");
      expect(alert!.source).toBe("trend");
    });

    it("does not flag when data points < minDataPoints (5)", () => {
      // Only 4 data points — not enough for rolling baseline
      const rawData = buildRawData([
        { date: "3/1", member: "Gina", total: 8 },
        { date: "3/2", member: "Gina", total: 8 },
        { date: "3/3", member: "Gina", total: 8 },
        { date: "3/4", member: "Gina", total: 2 },
      ]);
      const dates = ["3/1", "3/2", "3/3", "3/4"];
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Gina"], dates, emptyCommitData(), {}, null, "3/4")
      );
      const alert = result.current.find(a => a.member === "Gina" && a.type === "hours_drop");
      expect(alert).toBeUndefined();
    });
  });

  describe("Commit-based alerts", () => {
    it("flags commit frequency drop (7 days with commits, 7 days without)", () => {
      // Build 14 days of data: first 7 with commits, last 7 without
      const entries: Array<{ date: string; member: string; total: number }> = [];
      const commitData: CommitData = { commits: {}, analysis: {}, projectRisks: [] };
      for (let d = 1; d <= 14; d++) {
        entries.push({ date: `3/${d}`, member: "Hank", total: 8 });
        if (d <= 7) {
          // Add commits for first 7 days
          commitData.commits[`3/${d}`] = {
            Hank: {
              count: 2,
              projects: ["proj-a"],
              items: [
                { title: "fix", sha: `sha${d}a`, project: "proj-a", url: "http://x", source: "gitlab" },
                { title: "feat", sha: `sha${d}b`, project: "proj-a", url: "http://x", source: "gitlab" },
              ],
            },
          };
        }
      }
      const rawData = buildRawData(entries);
      const dates = entries.map(e => e.date);
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Hank"], dates, commitData, {}, null, "3/14")
      );
      const alert = result.current.find(a => a.member === "Hank" && a.type === "commit_drop");
      expect(alert).toBeDefined();
      expect(alert!.source).toBe("trend");
    });
  });

  describe("Sorting", () => {
    it("sorts by severity 🔴 → 🟡 → 🟠", () => {
      // Create multiple alerts of different severity
      const rawData = buildRawData([
        // extreme low → 🔴
        { date: "3/31", member: "Xander", total: 2 },
        // meeting heavy → 🟡
        { date: "3/31", member: "Yara", total: 8, meeting: 6, dev: 2 },
      ]);
      const { result } = renderHook(() =>
        useHealthAlerts(rawData, ["Xander", "Yara"], ["3/31"], emptyCommitData(), {}, null, "3/31")
      );
      const severities = result.current.map(a => a.severity);
      // All 🔴 should come before any 🟡
      const lastRed = severities.lastIndexOf("🔴");
      const firstYellow = severities.indexOf("🟡");
      if (lastRed >= 0 && firstYellow >= 0) {
        expect(lastRed).toBeLessThan(firstYellow);
      }
      // Verify we actually got both severities
      expect(severities).toContain("🔴");
      expect(severities).toContain("🟡");
    });
  });
});
