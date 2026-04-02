// src/hooks/useMemberProfile.ts
import { useMemo } from "react";
import type { MemberProfile, CommitData, TaskAnalysisData, LeaveRange } from "../types";
import { THRESHOLDS, HEALTH_THRESHOLDS } from "../constants";
import { isOnLeave } from "../utils";

type RawData = Record<string, Record<string, { total: number | null; meeting: number | null; dev: number | null }>> | null;

function getHourStatus(total: number | null): "normal" | "warning" | "danger" {
  if (total === null) return "danger";
  if (total < THRESHOLDS.low || total > THRESHOLDS.overtime) return "danger";
  if (total < THRESHOLDS.ok || total > THRESHOLDS.high) return "warning";
  return "normal";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function getMonday(dateStr: string): Date {
  const year = new Date().getFullYear();
  const [m, d] = dateStr.split("/").map(Number);
  const date = new Date(year, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - diff);
  return monday;
}

function weekKey(monday: Date): string {
  return `${monday.getMonth() + 1}/${monday.getDate()}`;
}

export function useMemberProfile(
  rawData: RawData,
  member: string,
  dates: string[],
  commitData: CommitData | null,
  leave: Record<string, LeaveRange[]>,
  taskAnalysisData: TaskAnalysisData | null
): MemberProfile {
  const leaveRanges = leave?.[member];

  const hoursTrend = useMemo(() => {
    return dates.map(date => {
      const entry = rawData?.[date]?.[member];
      const total = entry?.total ?? null;
      const meeting = entry?.meeting ?? null;
      const dev = entry?.dev ?? null;
      return { date, total, meeting, dev, status: getHourStatus(total) };
    });
  }, [rawData, member, dates]);

  const baseline = useMemo(() => {
    const hours: number[] = [];
    for (const date of dates) {
      if (isOnLeave(date, leaveRanges)) continue;
      const total = rawData?.[date]?.[member]?.total;
      if (total !== null && total !== undefined) {
        hours.push(total);
      }
    }
    if (hours.length < HEALTH_THRESHOLDS.minDataPoints) return null;
    return median(hours);
  }, [rawData, member, dates, leaveRanges]);

  const recentAvg = useMemo(() => {
    const last7 = dates.slice(-7);
    const hours: number[] = [];
    for (const date of last7) {
      const total = rawData?.[date]?.[member]?.total;
      if (total !== null && total !== undefined) {
        hours.push(total);
      }
    }
    if (hours.length === 0) return null;
    return hours.reduce((a, b) => a + b, 0) / hours.length;
  }, [rawData, member, dates]);

  const meetingPct = useMemo(() => {
    const last7 = dates.slice(-7);
    let totalMeeting = 0;
    let totalHours = 0;
    for (const date of last7) {
      const entry = rawData?.[date]?.[member];
      if (entry?.total !== null && entry?.total !== undefined && entry?.meeting !== null && entry?.meeting !== undefined) {
        totalMeeting += entry.meeting;
        totalHours += entry.total;
      }
    }
    if (totalHours === 0) return null;
    return (totalMeeting / totalHours) * 100;
  }, [rawData, member, dates]);

  const consistencyGrid = useMemo(() => {
    return dates.map(date => {
      const entry = commitData?.analysis?.[date]?.[member];
      return { date, status: (entry?.status as "✅" | "⚠️" | "🔴") ?? null };
    });
  }, [commitData, member, dates]);

  const consistencyRate = useMemo(() => {
    const entries = consistencyGrid.filter(g => g.status !== null);
    if (entries.length === 0) return 0;
    const checkCount = entries.filter(g => g.status === "✅").length;
    return (checkCount / entries.length) * 100;
  }, [consistencyGrid]);

  const projectDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const date of dates) {
      const memberCommits = commitData?.commits?.[date]?.[member];
      if (memberCommits?.items) {
        for (const item of memberCommits.items) {
          counts[item.project] = (counts[item.project] || 0) + 1;
          total++;
        }
      }
    }
    if (total === 0) return [];
    return Object.entries(counts)
      .map(([project, count]) => ({ project, count, pct: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [commitData, member, dates]);

  const totalCommits = useMemo(() => {
    let count = 0;
    for (const date of dates) {
      count += commitData?.commits?.[date]?.[member]?.items?.length ?? 0;
    }
    return count;
  }, [commitData, member, dates]);

  const recentCommits = useMemo(() => {
    const last7 = dates.slice(-7);
    let count = 0;
    for (const date of last7) {
      count += commitData?.commits?.[date]?.[member]?.items?.length ?? 0;
    }
    return count;
  }, [commitData, member, dates]);

  const prevCommits = useMemo(() => {
    const prev7 = dates.slice(-14, -7);
    let count = 0;
    for (const date of prev7) {
      count += commitData?.commits?.[date]?.[member]?.items?.length ?? 0;
    }
    return count;
  }, [commitData, member, dates]);

  const weeklyMeetingPct = useMemo(() => {
    const weekMap = new Map<string, { meeting: number; total: number }>();
    const weekOrder: string[] = [];
    for (const date of dates) {
      const entry = rawData?.[date]?.[member];
      if (entry?.total === null || entry?.total === undefined || entry?.meeting === null || entry?.meeting === undefined) continue;
      const monday = getMonday(date);
      const wk = weekKey(monday);
      if (!weekMap.has(wk)) {
        weekMap.set(wk, { meeting: 0, total: 0 });
        weekOrder.push(wk);
      }
      const acc = weekMap.get(wk)!;
      acc.meeting += entry.meeting;
      acc.total += entry.total;
    }
    return weekOrder
      .filter(wk => weekMap.get(wk)!.total > 0)
      .map(wk => {
        const { meeting, total } = weekMap.get(wk)!;
        return { week: wk, pct: (meeting / total) * 100 };
      });
  }, [rawData, member, dates]);

  const taskWarnings = useMemo(() => {
    if (!taskAnalysisData?.warnings) return [];
    return taskAnalysisData.warnings
      .filter(w => w.member === member)
      .slice(0, 5)
      .map(({ date, severity, type, task, reasoning }) => ({ date, severity, type, task, reasoning }));
  }, [taskAnalysisData, member]);

  return {
    hoursTrend,
    baseline,
    recentAvg,
    meetingPct,
    consistencyGrid,
    consistencyRate,
    projectDistribution,
    totalCommits,
    recentCommits,
    prevCommits,
    weeklyMeetingPct,
    taskWarnings,
  };
}
