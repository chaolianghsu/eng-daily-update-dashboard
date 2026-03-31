// src/components/SubViewPills.tsx
import { useEffect } from "react";
import { COLORS } from "../constants";
import { PillGroup } from "./PillGroup";
import type { PillItem } from "./PillGroup";
import type { CommitData, PlanAnalysisData } from "../types";

type SubView = "hours" | "commits" | "planspec";

interface SubViewPillsProps {
  activeView: SubView;
  onViewChange: (view: SubView) => void;
  activeDate: string;
  commitData: CommitData | null;
  planAnalysisData: PlanAnalysisData | null;
}

export function SubViewPills({ activeView, onViewChange, activeDate, commitData, planAnalysisData }: SubViewPillsProps) {
  // Compute badge counts
  const commitCount = commitData?.commits?.[activeDate]
    ? Object.values(commitData.commits[activeDate]).reduce((sum, m) => sum + m.count, 0)
    : 0;

  const specCount = planAnalysisData?.planSpecs
    ? planAnalysisData.planSpecs.filter(s => s.date === activeDate).length
    : 0;

  const hasCommits = commitData !== null;
  const hasSpecs = planAnalysisData !== null && specCount > 0;

  // Build pill items
  const items: PillItem[] = [
    { key: "hours", label: "📊 工時" },
  ];
  if (hasCommits) {
    items.push({ key: "commits", label: "🔀 Commits", badge: commitCount, badgeColor: COLORS.teal });
  }
  if (hasSpecs) {
    items.push({ key: "planspec", label: "📋 規劃", badge: specCount, badgeColor: "#a78bfa" });
  }

  // Fallback if current view is hidden
  const validKeys = items.map(i => i.key);
  useEffect(() => {
    if (!validKeys.includes(activeView)) {
      onViewChange("hours");
    }
  }, [activeView, validKeys.join(",")]);

  return (
    <PillGroup
      items={items}
      activeKey={validKeys.includes(activeView) ? activeView : "hours"}
      onSelect={(key) => onViewChange(key as SubView)}
    />
  );
}
