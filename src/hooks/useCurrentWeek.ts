// src/hooks/useCurrentWeek.ts
import { useMemo } from "react";
import { getWeekRange } from "../utils";

export function useCurrentWeek(dates: string[]): { dates: string[]; label: string } {
  return useMemo(() => {
    if (!dates.length) return { dates: [], label: "" };
    const year = new Date().getFullYear();
    const { monday, friday } = getWeekRange(new Date());

    let weekDates = dates.filter(d => {
      const [m, dd] = d.split('/').map(Number);
      const date = new Date(year, m - 1, dd);
      return date >= monday && date <= friday;
    });

    const fmtDate = (dt: Date) => `${dt.getMonth()+1}/${dt.getDate()}`;
    let label = `本週 ${fmtDate(monday)} – ${fmtDate(friday)}`;

    if (weekDates.length === 0 && dates.length > 0) {
      const latest = dates[dates.length - 1];
      const [lm, ld] = latest.split('/').map(Number);
      const latestDate = new Date(year, lm - 1, ld);
      const { monday: pMon, friday: pFri } = getWeekRange(latestDate);
      weekDates = dates.filter(d => {
        const [m, dd] = d.split('/').map(Number);
        const date = new Date(year, m - 1, dd);
        return date >= pMon && date <= pFri;
      });
      label = `${fmtDate(pMon)} – ${fmtDate(pFri)} 週`;
    }

    return { dates: weekDates, label };
  }, [dates]);
}
