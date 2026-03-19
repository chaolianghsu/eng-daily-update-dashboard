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
    expect(result.current[0].commitAvg).toBe(4);
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
});
