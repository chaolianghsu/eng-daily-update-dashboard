// src/hooks/useWeekNavigator.ts
import { useMemo, useState, useCallback } from "react";
import { getWeekRange } from "../utils";

const EMPTY_WEEK = { dates: [] as string[], label: "" };

export function useWeekNavigator(dates: string[]) {
  const weeks = useMemo(() => {
    if (!dates.length) return [] as Array<{ dates: string[]; label: string }>;
    const year = new Date().getFullYear();
    const weekMap = new Map<string, { mondayTs: number; dates: string[]; label: string }>();

    for (const d of dates) {
      const [m, dd] = d.split("/").map(Number);
      const date = new Date(year, m - 1, dd);
      const { monday, friday } = getWeekRange(date);
      const key = `${monday.getMonth() + 1}/${monday.getDate()}`;
      if (!weekMap.has(key)) {
        const fmtDate = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
        weekMap.set(key, { mondayTs: monday.getTime(), dates: [], label: `${fmtDate(monday)} – ${fmtDate(friday)}` });
      }
      weekMap.get(key)!.dates.push(d);
    }

    return Array.from(weekMap.values())
      .sort((a, b) => a.mondayTs - b.mondayTs)
      .map(w => ({ dates: w.dates, label: w.label }));
  }, [dates]);

  const [weekIndex, setWeekIndex] = useState(-1);

  const safeIndex = weeks.length === 0
    ? -1
    : weekIndex === -1
      ? weeks.length - 1
      : Math.min(weekIndex, weeks.length - 1);
  const currentWeek = safeIndex >= 0 ? weeks[safeIndex] : EMPTY_WEEK;
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < weeks.length - 1;
  const isThisWeek = safeIndex === weeks.length - 1;
  const isLastWeek = safeIndex === weeks.length - 2;

  const goToPrev = useCallback(() => { if (canGoPrev) setWeekIndex(safeIndex - 1); }, [canGoPrev, safeIndex]);
  const goToNext = useCallback(() => { if (canGoNext) setWeekIndex(safeIndex + 1); }, [canGoNext, safeIndex]);
  const goToWeek = useCallback((index: number) => {
    if (index >= 0 && index < weeks.length) setWeekIndex(index);
  }, [weeks.length]);
  const goToThisWeek = useCallback(() => setWeekIndex(weeks.length - 1), [weeks.length]);
  const goToLastWeek = useCallback(() => {
    if (weeks.length >= 2) setWeekIndex(weeks.length - 2);
  }, [weeks.length]);

  return {
    weeks,
    weekIndex: safeIndex,
    currentWeek,
    canGoPrev,
    canGoNext,
    isThisWeek,
    isLastWeek,
    goToPrev,
    goToNext,
    goToWeek,
    goToThisWeek,
    goToLastWeek,
  };
}
