// src/utils.ts
import { COLORS, THRESHOLDS } from "./constants";
import type { StatusInfo, LeaveRange } from "./types";

export function dateToNum(d: string): number {
  const p = d.split("/").map(Number);
  return p[0] * 100 + p[1];
}

export function isOnLeave(date: string, leaveRanges?: LeaveRange[]): boolean {
  if (!date || !leaveRanges) return false;
  const dn = dateToNum(date);
  return leaveRanges.some(r => dn >= dateToNum(r.start) && dn <= dateToNum(r.end));
}

export function getStatus(hours: number | null, onLeave?: boolean): StatusInfo {
  if (hours === null && onLeave) return { label: "休假", color: COLORS.orange, bg: COLORS.orangeDim };
  if (hours === null) return { label: "未回報", color: COLORS.red, bg: COLORS.redDim };
  if (hours > THRESHOLDS.overtime) return { label: "超時", color: COLORS.red, bg: COLORS.redDim };
  if (hours >= THRESHOLDS.high) return { label: "偏高", color: COLORS.yellow, bg: COLORS.yellowDim };
  if (hours >= THRESHOLDS.ok) return { label: "合理", color: COLORS.green, bg: COLORS.greenDim };
  if (hours >= THRESHOLDS.low) return { label: "偏低", color: COLORS.orange, bg: COLORS.orangeDim };
  return { label: "不足", color: COLORS.red, bg: COLORS.redDim };
}

export function getBarColor(hours: number | null): string {
  if (hours === null || hours === 0) return COLORS.textDim;
  if (hours > THRESHOLDS.high) return COLORS.yellow;
  if (hours >= THRESHOLDS.ok) return COLORS.accentLight;
  if (hours >= THRESHOLDS.low) return COLORS.orange;
  return COLORS.red;
}

export function getTrendIcon(v1: number | null, v2: number | null): string {
  if (v1 === null || v2 === null) return "—";
  const d = v2 - v1;
  if (d > 1) return "📈";
  if (d > 0) return "↗";
  if (d < -1) return "📉";
  if (d < 0) return "↘";
  return "➡️";
}

export function getWeekRange(refDate: Date): { monday: Date; friday: Date } {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  return { monday, friday };
}

export function extractRepoBase(commitUrl: string, source: string): string {
  if (source === "gitlab") {
    return commitUrl.replace(/\/-\/commit\/[^/]+$/, "");
  }
  return commitUrl.replace(/\/commit\/[^/]+$/, "");
}
