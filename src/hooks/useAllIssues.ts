// src/hooks/useAllIssues.ts
import { useMemo } from "react";
import type { Issue, CommitData } from "../types";

export function useAllIssues(
  issues: Issue[],
  commitData: CommitData | null,
  activeDate: string
): Issue[] {
  return useMemo(() => {
    const base = issues.filter(i => i.severity !== '🟢');
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
