// src/hooks/useHealthAlerts.ts
import { useMemo } from "react";
import type { HealthAlert, CommitData, TaskAnalysisData, LeaveRange } from "../types";
import { HEALTH_THRESHOLDS, THRESHOLDS } from "../constants";
import { isOnLeave } from "../utils";

const SEVERITY_ORDER: Record<string, number> = { "🔴": 0, "🟡": 1, "🟠": 2 };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mad(values: number[]): number {
  const med = median(values);
  const deviations = values.map(v => Math.abs(v - med));
  return median(deviations);
}

export function useHealthAlerts(
  rawData: Record<string, Record<string, { total: number | null; meeting: number | null; dev: number | null }>>,
  members: string[],
  dates: string[],
  commitData: CommitData | null,
  leave: Record<string, LeaveRange[]>,
  taskAnalysisData: TaskAnalysisData | null,
  activeDate: string,
): HealthAlert[] {
  return useMemo(() => {
    const alerts: HealthAlert[] = [];
    const seen = new Set<string>();

    function addAlert(alert: HealthAlert) {
      const key = `${alert.member}|${alert.type}`;
      if (seen.has(key)) return;
      seen.add(key);
      alerts.push(alert);
    }

    for (const member of members) {
      const memberLeave = leave?.[member];

      // Skip members on leave for the active date
      if (isOnLeave(activeDate, memberLeave)) continue;

      // --- Fixed threshold rules (based on activeDate) ---
      const dayData = rawData?.[activeDate]?.[member];

      if (dayData && dayData.total !== null) {
        // Extreme low hours
        if (dayData.total < HEALTH_THRESHOLDS.extremeLow) {
          addAlert({
            member,
            severity: "🔴",
            text: `${activeDate} 工時極低 (${dayData.total}h)`,
            source: "threshold",
            type: "low_hours",
          });
        }

        // Extreme high hours
        if (dayData.total > HEALTH_THRESHOLDS.extremeHigh) {
          addAlert({
            member,
            severity: "🔴",
            text: `${activeDate} 工時極高 (${dayData.total}h)`,
            source: "threshold",
            type: "high_hours",
          });
        }

        // Meeting heavy
        if (dayData.meeting !== null && dayData.total > 0) {
          const meetingPct = (dayData.meeting / dayData.total) * 100;
          if (meetingPct > HEALTH_THRESHOLDS.meetingHeavyPct) {
            addAlert({
              member,
              severity: "🟡",
              text: `${activeDate} 會議占比過高 (${Math.round(meetingPct)}%)`,
              source: "threshold",
              type: "meeting_heavy",
            });
          }
        }
      }

      // Consecutive low hours (look back from activeDate)
      const activeDateIdx = dates.indexOf(activeDate);
      if (activeDateIdx >= 0) {
        let consecutiveLow = 0;
        for (let i = activeDateIdx; i >= 0; i--) {
          const d = dates[i];
          if (isOnLeave(d, memberLeave)) break;
          const dd = rawData?.[d]?.[member];
          if (dd && dd.total !== null && dd.total < THRESHOLDS.ok) {
            consecutiveLow++;
          } else {
            break;
          }
        }
        if (consecutiveLow >= HEALTH_THRESHOLDS.consecutiveLowDays) {
          addAlert({
            member,
            severity: "🔴",
            text: `連續 ${consecutiveLow} 天工時偏低 (< ${THRESHOLDS.ok}h)`,
            source: "threshold",
            type: "consecutive_low",
          });
        }
      }

      // Consecutive unreported
      if (activeDateIdx >= 0) {
        let consecutiveUnreported = 0;
        for (let i = activeDateIdx; i >= 0; i--) {
          const d = dates[i];
          if (isOnLeave(d, memberLeave)) break;
          const dd = rawData?.[d]?.[member];
          if (!dd || dd.total === null) {
            consecutiveUnreported++;
          } else {
            break;
          }
        }
        if (consecutiveUnreported >= HEALTH_THRESHOLDS.consecutiveUnreportedDays) {
          addAlert({
            member,
            severity: "🔴",
            text: `連續 ${consecutiveUnreported} 天未回報`,
            source: "threshold",
            type: "unreported",
          });
        }
      }

      // --- Rolling baseline (MAD-based anomaly detection) ---
      // Collect all hours for this member within the rolling window up to activeDate
      if (activeDateIdx >= 0) {
        const windowStart = Math.max(0, activeDateIdx - HEALTH_THRESHOLDS.rollingWindowDays + 1);
        const windowDates = dates.slice(windowStart, activeDateIdx + 1);
        const hours: number[] = [];
        for (const d of windowDates) {
          if (isOnLeave(d, memberLeave)) continue;
          const dd = rawData?.[d]?.[member];
          if (dd && dd.total !== null) {
            hours.push(dd.total);
          }
        }

        if (hours.length >= HEALTH_THRESHOLDS.minDataPoints) {
          const baselineMedian = median(hours);
          const rawMad = mad(hours);
          const adjustedMad = rawMad * HEALTH_THRESHOLDS.madToSigma;

          // Compute recent average (last 3 data points)
          const recentHours = hours.slice(-3);
          const recentAvg = recentHours.reduce((s, v) => s + v, 0) / recentHours.length;

          const deviation = Math.abs(recentAvg - baselineMedian);
          // Use a minimum threshold for adjusted MAD to avoid division by zero / tiny MAD
          const threshold = Math.max(adjustedMad * HEALTH_THRESHOLDS.madMultiplier, 1);

          if (deviation > threshold) {
            if (recentAvg < baselineMedian) {
              addAlert({
                member,
                severity: "🟡",
                text: `工時趨勢下降 (近期平均 ${recentAvg.toFixed(1)}h vs 基線 ${baselineMedian.toFixed(1)}h)`,
                source: "trend",
                type: "hours_drop",
              });
            } else {
              addAlert({
                member,
                severity: "🟡",
                text: `工時趨勢上升 (近期平均 ${recentAvg.toFixed(1)}h vs 基線 ${baselineMedian.toFixed(1)}h)`,
                source: "trend",
                type: "hours_spike",
              });
            }
          }
        }
      }

      // --- Commit-based alerts ---
      if (commitData && activeDateIdx >= 0) {
        // Split dates into prev half and recent half (roughly half each)
        const halfIdx = Math.floor(activeDateIdx / 2);
        let prevCommits = 0;
        let recentCommits = 0;

        for (let i = 0; i <= activeDateIdx; i++) {
          const d = dates[i];
          const mc = commitData.commits?.[d]?.[member];
          const count = mc?.count ?? 0;
          if (i <= halfIdx) {
            prevCommits += count;
          } else {
            recentCommits += count;
          }
        }

        if (prevCommits >= 5 && recentCommits === 0) {
          addAlert({
            member,
            severity: "🟡",
            text: `提交頻率驟降 (前期 ${prevCommits} commits → 近期 0)`,
            source: "trend",
            type: "commit_drop",
          });
        }
      }
    }

    // Sort by severity: 🔴 → 🟡 → 🟠
    alerts.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

    return alerts;
  }, [rawData, members, dates, commitData, leave, taskAnalysisData, activeDate]);
}
