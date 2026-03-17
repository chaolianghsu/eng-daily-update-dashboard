// src/hooks/useTrendData.ts
import { useMemo } from "react";
import { getWeekRange } from "../utils";
import type { CommitData } from "../types";

interface TrendDataResult {
  trendDates: string[];
  trendData: any[];
  useWeeklyAgg: boolean;
  weekGroups: Array<{ key: string; label: string; dates: string[] }>;
}

export function useTrendData(
  rawData: Record<string, Record<string, any>> | null,
  dates: string[],
  members: string[],
  dayLabels: Record<string, string>,
  commitData: CommitData | null,
  trendRange: string
): TrendDataResult {
  const trendDates = useMemo(() => {
    const limits: Record<string, number> = { week: 5, "2weeks": 10, month: 22, all: Infinity };
    const n = limits[trendRange] || Infinity;
    return n >= dates.length ? dates : dates.slice(-n);
  }, [dates, trendRange]);

  const trendData = useMemo(() => {
    if (!rawData) return [];
    return trendDates.map(date => {
      const row: any = { date: `${date}（${dayLabels[date]}）` };
      const vals: number[] = [];
      members.forEach(m => {
        const v = rawData[date]?.[m]?.total ?? null;
        row[m] = v;
        if (v !== null) vals.push(v);
      });
      row['團隊平均'] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
      row['_min'] = vals.length ? Math.min(...vals) : null;
      row['_max'] = vals.length ? Math.max(...vals) : null;
      if (commitData?.commits?.[date]) {
        for (const m of members) {
          row[`_commit_${m}`] = commitData.commits[date]?.[m]?.count || 0;
        }
      }
      return row;
    });
  }, [rawData, trendDates, members, dayLabels, commitData]);

  const useWeeklyAgg = trendRange === 'month' || trendRange === 'all';

  const weekGroups = useMemo(() => {
    if (!useWeeklyAgg || !trendDates.length) return [];
    const year = new Date().getFullYear();
    const groups: any[] = [];
    let current: any = null;
    for (const d of trendDates) {
      const [m, dd] = d.split('/').map(Number);
      const date = new Date(year, m - 1, dd);
      const { monday } = getWeekRange(date);
      const wk = `${monday.getMonth()+1}/${monday.getDate()}`;
      if (!current || current.key !== wk) {
        const fri = new Date(monday);
        fri.setDate(monday.getDate() + 4);
        current = { key: wk, label: `${wk}–${fri.getMonth()+1}/${fri.getDate()}`, dates: [] };
        groups.push(current);
      }
      current.dates.push(d);
    }
    return groups;
  }, [trendDates, useWeeklyAgg]);

  return { trendDates, trendData, useWeeklyAgg, weekGroups };
}
