import type { MemberHours, ValidCode } from "../types";

export interface CodeAggregation {
  code: string;
  label: string;
  category?: string;
  totalHours: number;
  memberCount: number;
  members: string[]; // sorted by hours desc
  memberHours: Record<string, number>;
  weeklyHours: Record<string, number>; // key: M/D of week start
  gitlabProjectPrefixes?: string[];
}

// Aggregate item-level hours per code across rawData. Codes are sourced from
// validCodes (if provided) plus any extra codes seen in items[] (so unknown
// codes still surface). The special "(uncategorized)" code = null items.
export function aggregateByCode(
  rawData: Record<string, Record<string, MemberHours>>,
  validCodes: Record<string, ValidCode> | undefined,
  options: { dates?: string[]; members?: string[]; includeUncategorized?: boolean } = {}
): CodeAggregation[] {
  const memberFilter = options.members ? new Set(options.members) : null;
  const dateFilter = options.dates ? new Set(options.dates) : null;
  const includeUncat = options.includeUncategorized ?? true;

  // code -> aggregator scratch
  const agg = new Map<string, {
    totalHours: number;
    memberHours: Record<string, number>;
    weeklyHours: Record<string, number>;
  }>();

  for (const [date, day] of Object.entries(rawData)) {
    if (dateFilter && !dateFilter.has(date)) continue;
    for (const [member, entry] of Object.entries(day)) {
      if (memberFilter && !memberFilter.has(member)) continue;
      if (!entry.items) continue;
      for (const item of entry.items) {
        const key = item.code ?? "(uncategorized)";
        if (key === "(uncategorized)" && !includeUncat) continue;
        if (!agg.has(key)) {
          agg.set(key, { totalHours: 0, memberHours: {}, weeklyHours: {} });
        }
        const a = agg.get(key)!;
        a.totalHours += item.hours;
        a.memberHours[member] = (a.memberHours[member] || 0) + item.hours;
        a.weeklyHours[date] = (a.weeklyHours[date] || 0) + item.hours;
      }
    }
  }

  const results: CodeAggregation[] = [];
  for (const [code, a] of agg.entries()) {
    const info = validCodes?.[code];
    const members = Object.entries(a.memberHours)
      .sort(([, h1], [, h2]) => h2 - h1)
      .map(([m]) => m);
    results.push({
      code,
      label: info?.label ?? (code === "(uncategorized)" ? "未分類" : code),
      category: info?.category,
      totalHours: Math.round(a.totalHours * 10) / 10,
      memberCount: members.length,
      members,
      memberHours: a.memberHours,
      weeklyHours: a.weeklyHours,
      gitlabProjectPrefixes: info?.gitlabProjectPrefixes,
    });
  }

  return results.sort((a, b) => b.totalHours - a.totalHours);
}
