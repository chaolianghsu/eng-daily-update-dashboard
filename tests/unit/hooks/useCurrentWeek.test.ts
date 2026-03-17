// tests/unit/hooks/useCurrentWeek.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCurrentWeek } from "../../../src/hooks/useCurrentWeek";

describe("useCurrentWeek", () => {
  it("returns empty for no dates", () => {
    const { result } = renderHook(() => useCurrentWeek([]));
    expect(result.current.dates).toEqual([]);
    expect(result.current.label).toBe("");
  });

  it("filters dates within current week", () => {
    // Mock Date to Wednesday March 11, 2026
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 11));

    const dates = ["3/5", "3/6", "3/9", "3/10", "3/11", "3/12", "3/13"];
    const { result } = renderHook(() => useCurrentWeek(dates));

    // Week of 3/9-3/13
    expect(result.current.dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);
    expect(result.current.label).toContain("本週");

    vi.useRealTimers();
  });

  it("falls back to latest week when current week has no data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18)); // March 18 (next week)

    const dates = ["3/9", "3/10", "3/11"];
    const { result } = renderHook(() => useCurrentWeek(dates));

    expect(result.current.dates).toEqual(["3/9", "3/10", "3/11"]);
    expect(result.current.label).toContain("週");
    expect(result.current.label).not.toContain("本週");

    vi.useRealTimers();
  });
});
