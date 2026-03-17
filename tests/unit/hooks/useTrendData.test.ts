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
