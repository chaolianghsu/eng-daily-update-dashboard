// tests/components/SubViewPills.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubViewPills } from "../../src/components/SubViewPills";
import type { CommitData, PlanAnalysisData } from "../../src/types";

const mockCommitData: CommitData = {
  commits: {
    "3/24": {
      Alice: { count: 5, projects: ["proj1"], items: [] },
      Bob: { count: 7, projects: ["proj2"], items: [] },
    },
  },
  analysis: {},
  projectRisks: [],
};

const mockPlanData: PlanAnalysisData = {
  analysisDate: "2026-03-24",
  period: "3/24",
  planSpecs: [
    { date: "3/24", member: "Alice", commit: { title: "spec", sha: "abc", project: "p", url: "", source: "gitlab" }, files: ["docs/spec.md"] },
    { date: "3/24", member: "Bob", commit: { title: "plan", sha: "def", project: "p", url: "", source: "gitlab" }, files: ["docs/plan.md"] },
  ],
  summary: { totalSpecCommits: 2, totalCorrelations: 0, membersWithSpecs: 2, matched: 0, unmatched: 0, partial: 0 },
};

describe("SubViewPills", () => {
  it("renders hours pill always", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={null} planAnalysisData={null} />);
    expect(screen.getByText("📊 工時")).toBeInTheDocument();
  });

  it("hides commits pill when commitData is null", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={null} planAnalysisData={null} />);
    expect(screen.queryByText(/Commits/)).not.toBeInTheDocument();
  });

  it("shows commits pill with badge count when commitData exists", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={mockCommitData} planAnalysisData={null} />);
    expect(screen.getByText(/Commits/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // 5 + 7
  });

  it("shows plan pill with badge when planAnalysisData has specs for activeDate", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/24" commitData={null} planAnalysisData={mockPlanData} />);
    expect(screen.getByText(/規劃/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("hides plan pill when no specs for activeDate", () => {
    render(<SubViewPills activeView="hours" onViewChange={() => {}} activeDate="3/25" commitData={null} planAnalysisData={mockPlanData} />);
    expect(screen.queryByText(/規劃/)).not.toBeInTheDocument();
  });

  it("calls onViewChange when clicking a pill", () => {
    const onViewChange = vi.fn();
    render(<SubViewPills activeView="hours" onViewChange={onViewChange} activeDate="3/24" commitData={mockCommitData} planAnalysisData={null} />);
    fireEvent.click(screen.getByText(/Commits/));
    expect(onViewChange).toHaveBeenCalledWith("commits");
  });

  it("falls back to hours when active view is hidden", () => {
    const onViewChange = vi.fn();
    render(<SubViewPills activeView="commits" onViewChange={onViewChange} activeDate="3/24" commitData={null} planAnalysisData={null} />);
    expect(onViewChange).toHaveBeenCalledWith("hours");
  });
});
