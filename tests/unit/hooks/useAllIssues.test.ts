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
