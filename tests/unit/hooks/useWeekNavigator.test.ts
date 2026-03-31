// tests/unit/hooks/useWeekNavigator.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWeekNavigator } from "../../../src/hooks/useWeekNavigator";

describe("useWeekNavigator", () => {
  describe("week grouping", () => {
    it("returns empty state for no dates", () => {
      const { result } = renderHook(() => useWeekNavigator([]));
      expect(result.current.weeks).toEqual([]);
      expect(result.current.currentWeek).toEqual({ dates: [], label: "" });
      expect(result.current.canGoPrev).toBe(false);
      expect(result.current.canGoNext).toBe(false);
    });

    it("groups dates into weeks by Mon-Fri", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13)); // Fri March 13

      const dates = ["3/9", "3/10", "3/11", "3/12", "3/13"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weeks).toHaveLength(1);
      expect(result.current.weeks[0].dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);
      expect(result.current.currentWeek.dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);

      vi.useRealTimers();
    });

    it("groups dates spanning multiple weeks", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13)); // Fri March 13

      const dates = ["3/2", "3/3", "3/4", "3/9", "3/10", "3/11", "3/12", "3/13"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weeks).toHaveLength(2);
      expect(result.current.weeks[0].dates).toEqual(["3/2", "3/3", "3/4"]);
      expect(result.current.weeks[1].dates).toEqual(["3/9", "3/10", "3/11", "3/12", "3/13"]);

      vi.useRealTimers();
    });

    it("defaults to latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weekIndex).toBe(1); // latest
      expect(result.current.currentWeek.dates).toEqual(["3/9", "3/10"]);

      vi.useRealTimers();
    });

    it("generates week labels with date range", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/9", "3/10", "3/11"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.currentWeek.label).toContain("3/9");
      expect(result.current.currentWeek.label).toContain("3/13");

      vi.useRealTimers();
    });
  });

  describe("navigation", () => {
    it("goToPrev moves to earlier week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.weekIndex).toBe(1);
      act(() => result.current.goToPrev());
      expect(result.current.weekIndex).toBe(0);
      expect(result.current.currentWeek.dates).toEqual(["3/2", "3/3"]);

      vi.useRealTimers();
    });

    it("goToNext moves to later week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToPrev());
      expect(result.current.weekIndex).toBe(0);
      act(() => result.current.goToNext());
      expect(result.current.weekIndex).toBe(1);

      vi.useRealTimers();
    });

    it("canGoPrev is false at earliest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToPrev());
      expect(result.current.canGoPrev).toBe(false);
      act(() => result.current.goToPrev()); // no-op
      expect(result.current.weekIndex).toBe(0);

      vi.useRealTimers();
    });

    it("canGoNext is false at latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/2", "3/3", "3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      expect(result.current.canGoNext).toBe(false);

      vi.useRealTimers();
    });

    it("goToWeek jumps to specific week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20));

      const dates = ["3/2", "3/3", "3/9", "3/10", "3/16", "3/17"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToWeek(0));
      expect(result.current.currentWeek.dates).toEqual(["3/2", "3/3"]);

      vi.useRealTimers();
    });

    it("goToThisWeek jumps to latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20));

      const dates = ["3/2", "3/3", "3/9", "3/10", "3/16", "3/17"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToWeek(0));
      act(() => result.current.goToThisWeek());
      expect(result.current.weekIndex).toBe(2);
      expect(result.current.isThisWeek).toBe(true);

      vi.useRealTimers();
    });

    it("goToLastWeek jumps to second-latest week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 20));

      const dates = ["3/2", "3/3", "3/9", "3/10", "3/16", "3/17"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToLastWeek());
      expect(result.current.weekIndex).toBe(1);
      expect(result.current.isLastWeek).toBe(true);

      vi.useRealTimers();
    });

    it("goToLastWeek is no-op when only one week", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 13));

      const dates = ["3/9", "3/10"];
      const { result } = renderHook(() => useWeekNavigator(dates));

      act(() => result.current.goToLastWeek());
      expect(result.current.weekIndex).toBe(0); // stays at latest (only) week

      vi.useRealTimers();
    });
  });
});
