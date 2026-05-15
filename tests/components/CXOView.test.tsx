// tests/components/CXOView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { CXOView } from "../../src/views/CXOView";

const centers = {
  工程: { label: "工程部", members: ["A", "B"] },
  產品: { label: "產品中心", members: [] },
  技發: { label: "技發中心", members: [] },
};

const rawData = {
  "3/9": { A: { total: 8, meeting: 1, dev: 7 }, B: { total: 6, meeting: 2, dev: 4 } },
  "3/10": { A: { total: 8, meeting: 0, dev: 8 }, B: { total: 7, meeting: 1, dev: 6 } },
  "3/11": { A: { total: 9, meeting: 1, dev: 8 }, B: { total: 5, meeting: 0, dev: 5 } },
  "3/12": { A: { total: 7, meeting: 1, dev: 6 }, B: { total: 6, meeting: 1, dev: 5 } },
  "3/13": { A: { total: 8, meeting: 2, dev: 6 }, B: { total: 7, meeting: 1, dev: 6 } },
};

const commitData = {
  commits: {
    "3/13": {
      A: { count: 5, projects: ["p1"], items: [] },
      B: { count: 2, projects: ["p1"], items: [] },
    },
  },
  analysis: {
    "3/13": {
      A: { status: "✅", commitCount: 5, hours: 8 },
      B: { status: "⚠️", commitCount: 2, hours: 7 },
    },
  },
  projectRisks: [{ project: "solo-repo", soloContributor: "A", severity: "🟡" }],
};

const issues = [
  { member: "A", severity: "🔴", text: "超時 12hr" },
];

const baseProps = {
  rawData,
  commitData,
  taskAnalysisData: null,
  planAnalysisData: null,
  issues,
  members: ["A", "B"],
  dates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
  centers,
};

describe("CXOView", () => {
  it("renders without crashing", () => {
    render(<CXOView {...baseProps} />);
    expect(screen.getByTestId("cxo-view")).toBeInTheDocument();
  });

  it("renders 5 distinct card regions", () => {
    render(<CXOView {...baseProps} />);
    expect(screen.getByTestId("cxo-card-roi")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-spec")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-health")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-risks")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-capacity")).toBeInTheDocument();
  });

  it("shows placeholders for empty centers", () => {
    render(<CXOView {...baseProps} />);
    expect(screen.getAllByText(/尚未加入/).length).toBeGreaterThan(0);
  });

  it("renders top risks from issues", () => {
    render(<CXOView {...baseProps} />);
    // 超時 12hr should be visible in risks card
    expect(screen.getByText(/超時 12hr/)).toBeInTheDocument();
  });

  it("renders empty spec state when planAnalysisData is null", () => {
    render(<CXOView {...baseProps} />);
    expect(screen.getByText(/本週無 spec 活動/)).toBeInTheDocument();
  });

  it("switching center filter affects capacity card", () => {
    render(<CXOView {...baseProps} />);
    // Both A and B visible by default
    const capacityCard = screen.getByTestId("cxo-card-capacity");
    expect(capacityCard.textContent).toContain("A");
    expect(capacityCard.textContent).toContain("B");
    // Filter to 產品 → no members
    const select = screen.getByTestId("cxo-center-filter") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "產品" } });
    const updated = screen.getByTestId("cxo-card-capacity");
    expect(updated.textContent).not.toContain("A");
    expect(updated.textContent).not.toContain("B");
  });

  it("renders spec ownership rows when planAnalysisData provided", () => {
    const planAnalysisData = {
      analysisDate: "2026-03-13",
      period: "3/13",
      planSpecs: [
        {
          date: "3/13",
          member: "A",
          commit: { title: "spec: design X", sha: "s1", project: "p1", url: "u1", source: "gitlab" as const },
          files: ["docs/x.md"],
        },
      ],
      correlations: [
        { date: "3/13", member: "A", status: "matched" as const, specCommits: 1, dailyUpdateMention: true, matchedTasks: ["x"], unmatchedSpecs: [], reasoning: "ok" },
      ],
      summary: { totalSpecCommits: 1, totalCorrelations: 1, membersWithSpecs: 1, matched: 1, unmatched: 0, partial: 0 },
    };
    render(<CXOView {...baseProps} planAnalysisData={planAnalysisData} />);
    expect(screen.getByText(/spec: design X/)).toBeInTheDocument();
  });
});
