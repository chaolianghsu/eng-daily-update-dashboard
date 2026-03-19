// src/hooks/useWeeklySummary.ts
import { useMemo } from "react";
import { COLORS } from "../constants";
import { getTrendIcon } from "../utils";
import type { CommitData } from "../types";

export function useWeeklySummary(
  rawData: Record<string, Record<string, any>> | null,
  dates: string[],
  members: string[],
  commitData: CommitData | null = null
) {
  return useMemo(() => {
    if (!rawData) return [];
    return members.map(m => {
      let totalSum = 0, meetSum = 0, devSum = 0, count = 0;
      const dailyTotals: number[] = [];
      for (const d of dates) {
        const entry = rawData[d]?.[m];
        if (entry?.total != null) { totalSum += entry.total; count++; dailyTotals.push(entry.total); }
        if (entry?.meeting != null) { meetSum += entry.meeting; }
        if (entry?.dev != null) { devSum += entry.dev; }
      }
      const avg = count ? +(totalSum / count).toFixed(1) : null;
      const sum = count ? +totalSum.toFixed(1) : null;
      const devAvg = count ? +(devSum / count).toFixed(1) : null;
      const meetAvg = count ? +(meetSum / count).toFixed(1) : null;
      const stdDev = dailyTotals.length >= 2 ? Math.sqrt(dailyTotals.reduce((s, v) => s + (v - avg!) * (v - avg!), 0) / dailyTotals.length) : null;
      const maxStdDev = 3;
      const stabilityPct = stdDev !== null ? Math.max(0, 100 - (stdDev / maxStdDev) * 100) : 0;
      const stabilityColor = stabilityPct >= 70 ? COLORS.green : stabilityPct >= 40 ? COLORS.yellow : COLORS.orange;
      const v1 = rawData[dates[0]]?.[m]?.total ?? null;
      const v2 = rawData[dates[dates.length - 1]]?.[m]?.total ?? null;

      // Commit stats
      let commitTotal = 0;
      let daysWithCommits = 0;
      const consistency = { ok: 0, warn: 0, red: 0 };
      if (commitData) {
        for (const d of dates) {
          const memberCommits = commitData.commits[d]?.[m];
          if (memberCommits) {
            commitTotal += memberCommits.count;
            daysWithCommits++;
          }
          const analysisEntry = commitData.analysis[d]?.[m];
          if (analysisEntry) {
            if (analysisEntry.status === "✅") consistency.ok++;
            else if (analysisEntry.status === "⚠️") consistency.warn++;
            else if (analysisEntry.status === "🔴") consistency.red++;
          }
        }
      }
      const commitAvg = daysWithCommits ? +(commitTotal / daysWithCommits).toFixed(1) : 0;

      return { name: m, avg, sum, devAvg, meetAvg, daysReported: count, meetSum: +meetSum.toFixed(1), meetPct: sum ? Math.round(meetSum / sum * 100) : 0, trend: getTrendIcon(v1, v2), stdDev, stabilityPct, stabilityColor, commitTotal, commitAvg, consistency };
    }).sort((a, b) => (b.avg || -1) - (a.avg || -1));
  }, [rawData, dates, members, commitData]);
}
