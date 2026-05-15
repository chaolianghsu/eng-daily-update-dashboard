// src/hooks/useCXOMetrics.ts
import { useMemo } from "react";
import { dateToNum } from "../utils";
import type {
  CommitData,
  TaskAnalysisData,
  PlanAnalysisData,
  Issue,
} from "../types";

// ----- Types -----

export interface CenterConfig {
  label: string;
  members: string[];
}

export type CentersMap = Record<string, CenterConfig> | null | undefined;

export interface Period {
  dates: string[];
}

export interface CenterROI {
  center: string;
  label: string;
  devHours: number;
  commits: number;
  items: number;
  peopleMonth: number;
  members: string[];
  placeholder: boolean;
}

export interface ParentCenterConfig {
  label: string;
  children: string[];
}

export type ParentCentersMap = Record<string, ParentCenterConfig> | null | undefined;

export interface ParentCenterROI {
  parentCenter: string;
  label: string;
  devHours: number;
  commits: number;
  items: number;
  peopleMonth: number;
  departments: string[];
  childMetrics: Array<{
    dept: string;
    label: string;
    devHours: number;
    commits: number;
    items: number;
    peopleMonth: number;
  }>;
}

export interface SpecOwnershipRow {
  date: string;
  member: string;
  center: string;
  title: string;
  url: string;
  files: string[];
  status: "matched" | "unmatched" | "partial" | "unknown";
  reasoning: string;
}

export interface WeeklyHealth {
  reportingRate: number;
  consistency: { ok: number; warn: number; crit: number };
  warnings: { crit: number; warn: number };
}

export type RiskKind =
  | "issue"
  | "task_warning"
  | "orphan_commits"
  | "solo_project";

export interface Risk {
  kind: RiskKind;
  severity: "🔴" | "🟡" | "🟠";
  member: string;
  text: string;
  hint: string;
  date?: string;
}

export interface CapacityMember {
  name: string;
  weeks: number[]; // hours per week (oldest → newest)
}

export interface CapacityCenter {
  center: string;
  label: string;
  members: CapacityMember[];
}

export interface CapacityHeatmap {
  centers: CapacityCenter[];
  weekLabels: string[]; // labels for each column oldest → newest
}

// ----- Helpers -----

const SEVERITY_RANK: Record<string, number> = { "🔴": 3, "🟡": 2, "🟠": 1, "🟢": 0 };

function defaultCenters(rawData: Record<string, Record<string, any>> | null): Record<string, CenterConfig> {
  if (!rawData) return { 工程: { label: "工程部", members: [] } };
  const members = new Set<string>();
  for (const d of Object.keys(rawData)) {
    for (const m of Object.keys(rawData[d])) members.add(m);
  }
  return { 工程: { label: "工程部", members: Array.from(members) } };
}

function memberToCenterMap(centers: CentersMap, rawData?: Record<string, Record<string, any>> | null): Record<string, string> {
  const map: Record<string, string> = {};
  const eff = centers || defaultCenters(rawData || null);
  for (const [c, cfg] of Object.entries(eff)) {
    for (const m of cfg.members) map[m] = c;
  }
  return map;
}

export function resolvePeriod(period: Period | undefined, allDates: string[]): Period {
  if (period && period.dates && period.dates.length > 0) return period;
  return { dates: allDates };
}

// ----- Hooks -----

export function useCenterROI(
  rawData: Record<string, Record<string, any>> | null,
  commitData: CommitData | null,
  period: Period,
  centers: CentersMap
): CenterROI[] {
  return useMemo(() => {
    if (!rawData) return [];
    const eff = centers && Object.keys(centers).length > 0 ? centers : defaultCenters(rawData);
    const workdays = Math.max(period.dates.length, 1);
    const out: CenterROI[] = [];
    for (const [center, cfg] of Object.entries(eff)) {
      const placeholder = !cfg.members || cfg.members.length === 0;
      let devHours = 0;
      let commits = 0;
      let items = 0;
      for (const d of period.dates) {
        const dayRaw = rawData[d] || {};
        for (const m of cfg.members) {
          const e = dayRaw[m];
          if (e?.dev != null) devHours += e.dev;
          if (Array.isArray(e?.items)) items += e.items.length;
          const c = commitData?.commits?.[d]?.[m];
          if (c) commits += c.count;
        }
      }
      const peopleMonth = devHours / 8 / workdays;
      out.push({
        center,
        label: cfg.label,
        devHours: +devHours.toFixed(2),
        commits,
        items,
        peopleMonth: +peopleMonth.toFixed(3),
        members: cfg.members,
        placeholder,
      });
    }
    return out;
  }, [rawData, commitData, period, centers]);
}

export function useParentCenterROI(
  rawData: Record<string, Record<string, any>> | null,
  commitData: CommitData | null,
  parentCenters: ParentCentersMap,
  centers: CentersMap,
  period: Period
): ParentCenterROI[] {
  return useMemo(() => {
    if (!rawData) return [];
    if (!parentCenters || Object.keys(parentCenters).length === 0) return [];
    if (!centers) return [];
    const workdays = Math.max(period.dates.length, 1);
    const out: ParentCenterROI[] = [];

    for (const [parentKey, parentCfg] of Object.entries(parentCenters)) {
      const childMetrics: ParentCenterROI["childMetrics"] = [];
      let totalDev = 0;
      let totalCommits = 0;
      let totalItems = 0;
      const validChildren: string[] = [];

      for (const deptKey of parentCfg.children) {
        const deptCfg = centers[deptKey];
        if (!deptCfg) continue; // skip missing dept config
        validChildren.push(deptKey);

        let devHours = 0;
        let commits = 0;
        let items = 0;
        for (const d of period.dates) {
          const dayRaw = rawData[d] || {};
          for (const m of deptCfg.members) {
            const e = dayRaw[m];
            if (e?.dev != null) devHours += e.dev;
            if (Array.isArray(e?.items)) items += e.items.length;
            const c = commitData?.commits?.[d]?.[m];
            if (c) commits += c.count;
          }
        }
        const childPM = devHours / 8 / workdays;
        childMetrics.push({
          dept: deptKey,
          label: deptCfg.label,
          devHours: +devHours.toFixed(2),
          commits,
          items,
          peopleMonth: +childPM.toFixed(3),
        });
        totalDev += devHours;
        totalCommits += commits;
        totalItems += items;
      }

      out.push({
        parentCenter: parentKey,
        label: parentCfg.label || parentKey,
        devHours: +totalDev.toFixed(2),
        commits: totalCommits,
        items: totalItems,
        peopleMonth: +(totalDev / 8 / workdays).toFixed(3),
        departments: validChildren,
        childMetrics,
      });
    }
    return out;
  }, [rawData, commitData, parentCenters, centers, period]);
}

export function useSpecOwnership(
  planAnalysis: PlanAnalysisData | null,
  centers: CentersMap,
  limit = 8
): SpecOwnershipRow[] {
  return useMemo(() => {
    if (!planAnalysis || !planAnalysis.planSpecs) return [];
    const m2c = memberToCenterMap(centers);
    const corrByKey: Record<string, { status: SpecOwnershipRow["status"]; reasoning: string }> = {};
    for (const cor of planAnalysis.correlations || []) {
      corrByKey[`${cor.date}|${cor.member}`] = { status: cor.status, reasoning: cor.reasoning };
    }
    const rows = [...planAnalysis.planSpecs]
      .sort((a, b) => dateToNum(b.date) - dateToNum(a.date))
      .slice(0, limit)
      .map(s => {
        const c = corrByKey[`${s.date}|${s.member}`];
        return {
          date: s.date,
          member: s.member,
          center: m2c[s.member] || "工程",
          title: s.commit.title,
          url: s.commit.url,
          files: s.files,
          status: (c?.status as SpecOwnershipRow["status"]) || "unknown",
          reasoning: c?.reasoning || "",
        };
      });
    return rows;
  }, [planAnalysis, centers, limit]);
}

export function useWeeklyHealth(
  rawData: Record<string, Record<string, any>> | null,
  commitData: CommitData | null,
  taskAnalysis: TaskAnalysisData | null,
  period: Period,
  members: string[]
): WeeklyHealth {
  return useMemo(() => {
    if (!period.dates.length || !members.length || !rawData) {
      return { reportingRate: 0, consistency: { ok: 0, warn: 0, crit: 0 }, warnings: { crit: 0, warn: 0 } };
    }
    let slots = 0;
    let reported = 0;
    for (const d of period.dates) {
      const day = rawData[d] || {};
      for (const m of members) {
        slots++;
        if (day[m]?.total != null) reported++;
      }
    }
    const reportingRate = slots ? Math.round((reported / slots) * 100) : 0;
    const consistency = { ok: 0, warn: 0, crit: 0 };
    if (commitData?.analysis) {
      for (const d of period.dates) {
        const day = commitData.analysis[d] || {};
        for (const m of members) {
          const a = day[m];
          if (!a) continue;
          if (a.status === "✅") consistency.ok++;
          else if (a.status === "⚠️") consistency.warn++;
          else if (a.status === "🔴") consistency.crit++;
        }
      }
    }
    const warnings = { crit: 0, warn: 0 };
    if (taskAnalysis?.warnings) {
      const dateSet = new Set(period.dates);
      for (const w of taskAnalysis.warnings) {
        if (!dateSet.has(w.date)) continue;
        if (w.severity === "🔴") warnings.crit++;
        else if (w.severity === "🟡") warnings.warn++;
      }
    }
    return { reportingRate, consistency, warnings };
  }, [rawData, commitData, taskAnalysis, period, members]);
}

export function useTopRisks(
  issues: Issue[],
  taskAnalysis: TaskAnalysisData | null,
  commitData: CommitData | null,
  rawData: Record<string, Record<string, any>> | null,
  members: string[],
  period: Period,
  orphanCommitThreshold = 5
): Risk[] {
  return useMemo(() => {
    const out: Risk[] = [];
    // 1. Issues from raw_data (skip 🟢)
    for (const i of issues || []) {
      if (i.severity === "🟢") continue;
      out.push({
        kind: "issue",
        severity: i.severity as Risk["severity"],
        member: i.member,
        text: i.text,
        hint: hintFromText(i.text, i.member),
      });
    }
    // 2. Task warnings within period
    if (taskAnalysis?.warnings) {
      const dateSet = period.dates.length ? new Set(period.dates) : null;
      for (const w of taskAnalysis.warnings) {
        if (dateSet && !dateSet.has(w.date)) continue;
        if (w.severity !== "🔴" && w.severity !== "🟡") continue;
        out.push({
          kind: "task_warning",
          severity: w.severity as Risk["severity"],
          member: w.member,
          text: `${w.task.slice(0, 60)}`,
          hint: `聯絡 ${w.member} 確認任務合理性`,
          date: w.date,
        });
      }
    }
    // 3. Orphan: commits ≥ threshold but no daily report
    if (commitData?.commits && rawData) {
      for (const d of period.dates) {
        const dayCommits = commitData.commits[d] || {};
        const dayRaw = rawData[d] || {};
        for (const m of members) {
          const c = dayCommits[m]?.count || 0;
          const reported = dayRaw[m]?.total != null;
          if (c >= orphanCommitThreshold && !reported) {
            out.push({
              kind: "orphan_commits",
              severity: "🔴",
              member: m,
              text: `${d} 有 ${c} commits 但無 daily update`,
              hint: `聯絡 ${m} 補回報`,
              date: d,
            });
          }
        }
      }
    }
    // 4. Single-contributor project risks
    if (commitData?.projectRisks) {
      for (const r of commitData.projectRisks) {
        out.push({
          kind: "solo_project",
          severity: (r.severity as Risk["severity"]) || "🟡",
          member: r.soloContributor,
          text: `${r.project} 僅 ${r.soloContributor} 一人貢獻`,
          hint: `安排 ${r.soloContributor} 的知識傳承`,
        });
      }
    }
    // Sort by severity rank desc, then date desc
    out.sort((a, b) => {
      const sd = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (sd !== 0) return sd;
      const ad = a.date ? dateToNum(a.date) : 0;
      const bd = b.date ? dateToNum(b.date) : 0;
      return bd - ad;
    });
    return out.slice(0, 5);
  }, [issues, taskAnalysis, commitData, rawData, members, period, orphanCommitThreshold]);
}

function hintFromText(text: string, member: string): string {
  if (text.includes("超時")) return "留意工作量分配";
  if (text.includes("未回報")) return `聯絡 ${member} 確認狀態`;
  if (text.includes("連續")) return "建議主動聯繫";
  if (text.includes("不足") || text.includes("偏低")) return "建議了解狀況";
  if (text.includes("會議")) return "留意會議時間";
  return `關注 ${member} 狀況`;
}

export function useCapacityHeatmap(
  rawData: Record<string, Record<string, any>> | null,
  dates: string[],
  weeks: number,
  centers: CentersMap
): CapacityHeatmap {
  return useMemo(() => {
    if (!rawData) return { centers: [], weekLabels: [] };
    // Group dates into weeks (Mon–Sun). Use sequential 5-day workday buckets
    // anchored by date order; we sort dates and chunk by ISO week using current year.
    const sorted = [...dates].sort((a, b) => dateToNum(a) - dateToNum(b));
    const year = new Date().getFullYear();
    const dateToWeekKey = (d: string): string => {
      const [m, dd] = d.split("/").map(Number);
      const dt = new Date(year, m - 1, dd);
      // ISO week-like: monday-anchored
      const day = dt.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - diff);
      return `${monday.getMonth() + 1}/${monday.getDate()}`;
    };
    // Identify last N weeks
    const weekOrder: string[] = [];
    const weekSet = new Set<string>();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const wk = dateToWeekKey(sorted[i]);
      if (!weekSet.has(wk)) {
        weekSet.add(wk);
        weekOrder.unshift(wk); // oldest at front
        if (weekOrder.length >= weeks) break;
      }
    }
    // Ensure we have exactly `weeks` columns; pad oldest side with placeholders
    while (weekOrder.length < weeks) weekOrder.unshift("—");
    const weekIndex = (d: string): number => weekOrder.indexOf(dateToWeekKey(d));

    const eff = centers && Object.keys(centers).length > 0 ? centers : defaultCenters(rawData);
    const centersOut: CapacityCenter[] = [];
    for (const [center, cfg] of Object.entries(eff)) {
      const memberRows: CapacityMember[] = cfg.members.map(name => {
        const buckets = Array.from({ length: weeks }, () => 0);
        for (const d of sorted) {
          const idx = weekIndex(d);
          if (idx < 0) continue;
          const dev = rawData[d]?.[name]?.dev;
          if (typeof dev === "number") buckets[idx] += dev;
        }
        return { name, weeks: buckets.map(h => +h.toFixed(1)) };
      });
      centersOut.push({ center, label: cfg.label, members: memberRows });
    }
    return { centers: centersOut, weekLabels: weekOrder };
  }, [rawData, dates, weeks, centers]);
}
