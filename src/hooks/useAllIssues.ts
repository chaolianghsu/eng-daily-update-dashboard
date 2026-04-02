import { useMemo } from "react";
import { dateToNum } from "../utils";
import type { Issue, CommitData, HealthAlert } from "../types";

const DATE_PATTERN = /(\d+\/\d+)/g;
const SEVERITY_ORDER: Record<string, number> = { "🔴": 0, "🟡": 1, "🟠": 2 };

export function useAllIssues(
  issues: Issue[],
  commitData: CommitData | null,
  activeDate: string,
  healthAlerts: HealthAlert[] = []
): Issue[] {
  return useMemo(() => {
    if (!activeDate) return issues.filter(i => i.severity !== '🟢');
    const activeDateNum = dateToNum(activeDate);
    const base = issues.filter(i => {
      if (i.severity === '🟢') return false;
      const dates = i.text.match(DATE_PATTERN);
      if (!dates) return true;
      return dates.some(d => dateToNum(d) === activeDateNum);
    });
    if (commitData) {
      const activeAnalysis = commitData.analysis?.[activeDate] || {};
      for (const [m, a] of Object.entries(activeAnalysis)) {
        if (a.status === '🔴') {
          base.push({ member: m, severity: '🔴', text: `有 ${a.commitCount} commits 但未回報工時` });
        }
      }
    }

    for (const alert of healthAlerts) {
      base.push({
        member: alert.member,
        severity: alert.severity,
        text: alert.text,
        source: alert.source,
      });
    }

    return base.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );
  }, [issues, commitData, activeDate, healthAlerts]);
}
