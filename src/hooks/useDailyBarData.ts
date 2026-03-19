// src/hooks/useDailyBarData.ts
import { useMemo } from "react";

export function useDailyBarData(
  rawData: Record<string, Record<string, any>> | null,
  activeDate: string,
  members: string[]
) {
  return useMemo(() => {
    if (!rawData || !activeDate) return [];
    return members.map(m => {
      const d = rawData[activeDate]?.[m] || { total: null, meeting: null, dev: null, status: 'unreported' as const };
      return { name: m, 開發: d.dev, 會議: d.meeting, total: d.total, status: d.status || 'unreported' };
    }).sort((a, b) => (b.total || -1) - (a.total || -1));
  }, [rawData, activeDate, members]);
}
