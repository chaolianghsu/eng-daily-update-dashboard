import type { MemberHours } from "../types";

export interface UncategorizedStats {
  uncategorizedHours: number;
  categorizedHours: number;
  totalHoursWithItems: number;
  rate: number | null; // null when no items data exists yet
}

// Aggregate items[] across all member entries to compute the uncategorized
// (code=null) share of recorded hours. Returns rate=null when no entry has
// an items field — i.e. legacy data only.
export function computeUncategorizedStats(
  rawData: Record<string, Record<string, MemberHours>>,
  options: { dates?: string[]; members?: string[] } = {}
): UncategorizedStats {
  let uncategorizedHours = 0;
  let categorizedHours = 0;
  let sawItems = false;

  const allDates = options.dates ?? Object.keys(rawData);
  const memberFilter = options.members ? new Set(options.members) : null;

  for (const date of allDates) {
    const day = rawData[date];
    if (!day) continue;
    for (const [member, entry] of Object.entries(day)) {
      if (memberFilter && !memberFilter.has(member)) continue;
      if (!entry.items) continue;
      sawItems = true;
      for (const item of entry.items) {
        if (item.code === null) uncategorizedHours += item.hours;
        else categorizedHours += item.hours;
      }
    }
  }

  const total = uncategorizedHours + categorizedHours;
  return {
    uncategorizedHours: Math.round(uncategorizedHours * 10) / 10,
    categorizedHours: Math.round(categorizedHours * 10) / 10,
    totalHoursWithItems: Math.round(total * 10) / 10,
    rate: sawItems && total > 0 ? Math.round((uncategorizedHours / total) * 1000) / 10 : null,
  };
}
