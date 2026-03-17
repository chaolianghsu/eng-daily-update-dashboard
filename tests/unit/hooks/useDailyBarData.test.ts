// tests/unit/hooks/useDailyBarData.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDailyBarData } from "../../../src/hooks/useDailyBarData";

describe("useDailyBarData", () => {
  it("returns empty array for null rawData", () => {
    const { result } = renderHook(() => useDailyBarData(null, "3/5", ["A"]));
    expect(result.current).toEqual([]);
  });

  it("returns empty array for empty activeDate", () => {
    const { result } = renderHook(() => useDailyBarData({}, "", ["A"]));
    expect(result.current).toEqual([]);
  });

  it("maps member data correctly", () => {
    const rawData = {
      "3/5": {
        "Alice": { total: 8, meeting: 2, dev: 6 },
        "Bob": { total: 6, meeting: 1, dev: 5 },
      },
    };
    const { result } = renderHook(() => useDailyBarData(rawData, "3/5", ["Alice", "Bob"]));
    expect(result.current).toHaveLength(2);
    expect(result.current[0].name).toBe("Alice"); // sorted by total desc
    expect(result.current[0].total).toBe(8);
    expect(result.current[0]["開發"]).toBe(6);
    expect(result.current[0]["會議"]).toBe(2);
  });

  it("sorts by total descending", () => {
    const rawData = {
      "3/5": {
        "A": { total: 5, meeting: 1, dev: 4 },
        "B": { total: 9, meeting: 2, dev: 7 },
      },
    };
    const { result } = renderHook(() => useDailyBarData(rawData, "3/5", ["A", "B"]));
    expect(result.current[0].name).toBe("B");
    expect(result.current[1].name).toBe("A");
  });

  it("handles missing member data with nulls", () => {
    const rawData = { "3/5": {} };
    const { result } = renderHook(() => useDailyBarData(rawData, "3/5", ["A"]));
    expect(result.current[0].total).toBeNull();
  });
});
