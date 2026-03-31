// src/hooks/useWeekNavigator.ts
import { useMemo, useState, useCallback } from "react";
import { getWeekRange } from "../utils";

interface Week {
  dates: string[];
  monday: Date;
  friday: Date;
  label: string;
}

export function useWeekNavigator(dates: string[]) {
  const weeks: Week[] = useMemo(() => {
    if (!dates.length) return [];
    const year = new Date().getFullYear();
    const weekMap = new Map<string, { monday: Date; friday: Date; dates: string[] }>();

    for (const d of dates) {
      const [m, dd] = d.split("/").map(Number);
      const date = new Date(year, m - 1, dd);
      const { monday, friday } = getWeekRange(date);
      const key = `${monday.getMonth() + 1}/${monday.getDate()}`;
      if (!weekMap.has(key)) {
        weekMap.set(key, { monday, friday, dates: [] });
      }
      weekMap.get(key)!.dates.push(d);
    }

    const fmtDate = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
    return Array.from(weekMap.values())
      .sort((a, b) => a.monday.getTime() - b.monday.getTime())
      .map(w => ({
        dates: w.dates,
        monday: w.monday,
        friday: w.friday,
        label: `${fmtDate(w.monday)} – ${fmtDate(w.friday)}`,
      }));
  }, [dates]);

  const [weekIndex, setWeekIndex] = useState(() => Math.max(0, weeks.length - 1));

  const safeIndex = weeks.length === 0 ? -1 : Math.min(weekIndex, weeks.length - 1);
  const currentWeek = safeIndex >= 0 ? weeks[safeIndex] : { dates: [] as string[], label: "", monday: new Date(), friday: new Date() };
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < weeks.length - 1;
  const isThisWeek = safeIndex === weeks.length - 1;
  const isLastWeek = safeIndex === weeks.length - 2;

  const goToPrev = useCallback(() => { if (canGoPrev) setWeekIndex(i => i - 1); }, [canGoPrev]);
  const goToNext = useCallback(() => { if (canGoNext) setWeekIndex(i => i + 1); }, [canGoNext]);
  const goToWeek = useCallback((index: number) => {
    if (index >= 0 && index < weeks.length) setWeekIndex(index);
  }, [weeks.length]);
  const goToThisWeek = useCallback(() => setWeekIndex(weeks.length - 1), [weeks.length]);
  const goToLastWeek = useCallback(() => {
    if (weeks.length >= 2) setWeekIndex(weeks.length - 2);
  }, [weeks.length]);

  return {
    weeks: weeks.map(w => ({ dates: w.dates, label: w.label })),
    weekIndex: safeIndex,
    currentWeek: { dates: currentWeek.dates, label: currentWeek.label },
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
