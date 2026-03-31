// src/hooks/useAllIssues.ts
import { useMemo } from "react";
import { dateToNum } from "../utils";
import type { Issue, CommitData } from "../types";

const DATE_PATTERN = /(\d+\/\d+)/g;

export function useAllIssues(
  issues: Issue[],
  commitData: CommitData | null,
  activeDate: string
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
    if (!commitData) return base;
    const activeAnalysis = commitData.analysis?.[activeDate] || {};
    for (const [m, a] of Object.entries(activeAnalysis)) {
      if (a.status === '🔴') {
        base.push({ member: m, severity: '🔴', text: `有 ${a.commitCount} commits 但未回報工時` });
      }
    }
    return base;
  }, [issues, commitData, activeDate]);
}
