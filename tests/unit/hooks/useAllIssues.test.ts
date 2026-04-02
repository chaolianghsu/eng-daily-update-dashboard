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

  it("filters out issues referencing dates different from activeDate", () => {
    const issues = [
      { member: "A", severity: "🔴", text: "未回報 3/31" },
      { member: "B", severity: "🔴", text: "未回報 3/30" },
      { member: "C", severity: "🟠", text: "休假 3/31" },
    ];
    const { result } = renderHook(() => useAllIssues(issues, null, "3/30"));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].member).toBe("B");
  });

  it("keeps issues with no date reference for any activeDate", () => {
    const issues = [
      { member: "A", severity: "🔴", text: "超時" },
      { member: "B", severity: "🔴", text: "未回報 3/31" },
    ];
    const { result } = renderHook(() => useAllIssues(issues, null, "3/30"));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].member).toBe("A");
  });

  it("keeps issue if any referenced date matches activeDate", () => {
    const issues = [
      { member: "A", severity: "🔴", text: "連續 2 天未回報 (3/27, 3/31)" },
    ];
    const { result } = renderHook(() => useAllIssues(issues, null, "3/27"));
    expect(result.current).toHaveLength(1);
    const result2 = renderHook(() => useAllIssues(issues, null, "3/30"));
    expect(result2.result.current).toHaveLength(0);
  });

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
      expect(result.current).toHaveLength(2);
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
});
