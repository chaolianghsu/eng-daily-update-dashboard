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

const parentCenters = {
  產品中心: { label: "產品中心", children: ["工程", "技發"] },
};

const baseProps = {
  rawData,
  commitData,
  taskAnalysisData: null,
  planAnalysisData: null,
  issues,
  members: ["A", "B"],
  dates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
  centers,
  parentCenters,
};

describe("CXOView", () => {
  it("renders without crashing", () => {
    render(<CXOView {...baseProps} />);
    expect(screen.getByTestId("cxo-view")).toBeInTheDocument();
  });

  it("renders all distinct card regions including split ROI cards", () => {
    render(<CXOView {...baseProps} />);
    expect(screen.getByTestId("cxo-card-roi-parent")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-roi-dept")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-spec")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-health")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-risks")).toBeInTheDocument();
    expect(screen.getByTestId("cxo-card-capacity")).toBeInTheDocument();
  });

  it("Card 1A renders parent center ROI (產品中心)", () => {
    render(<CXOView {...baseProps} />);
    const card = screen.getByTestId("cxo-card-roi-parent");
    expect(card.textContent).toContain("產品中心");
  });

  it("Card 1B renders department ROI grouped by parent center", () => {
    render(<CXOView {...baseProps} />);
    const card = screen.getByTestId("cxo-card-roi-dept");
    // The department names should appear in card 1B
    expect(card.textContent).toContain("工程部");
    expect(card.textContent).toContain("產品中心");
  });

  it("Card 1A shows 'only one center' note when single parentCenter", () => {
    render(<CXOView {...baseProps} />);
    const card = screen.getByTestId("cxo-card-roi-parent");
    expect(card.textContent).toMatch(/目前只有一個中心/);
  });

  it("renders Card 1B with multi-parent grouping when 2+ parentCenters", () => {
    const multiParent = {
      產品中心: { label: "產品中心", children: ["工程"] },
      數據平台中心: { label: "數據平台中心", children: ["分析"] },
    };
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      分析: { label: "分析部", members: ["D"], parent: "數據平台中心" },
    };
    const rawMulti = {
      "3/13": {
        A: { total: 8, meeting: 1, dev: 7 },
        D: { total: 7, meeting: 1, dev: 6 },
      },
    };
    render(<CXOView {...baseProps}
      centers={centersMulti}
      parentCenters={multiParent}
      rawData={rawMulti}
      members={["A", "D"]}
      dates={["3/13"]} />);
    const card = screen.getByTestId("cxo-card-roi-dept");
    expect(card.textContent).toContain("產品中心");
    expect(card.textContent).toContain("數據平台中心");
  });

  it("falls back gracefully when parentCenters prop missing", () => {
    render(<CXOView {...baseProps} parentCenters={undefined} />);
    expect(screen.getByTestId("cxo-card-roi-dept")).toBeInTheDocument();
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
    // Filter to 產品 dept (empty placeholder) → no members
    // Selector is now two-tier: pick parent 產品中心 first, then dept 產品.
    const parentSel = screen.getByTestId("cxo-parent-filter") as HTMLSelectElement;
    fireEvent.change(parentSel, { target: { value: "產品中心" } });
    const deptSel = screen.getByTestId("cxo-dept-filter") as HTMLSelectElement;
    fireEvent.change(deptSel, { target: { value: "產品" } });
    const updated = screen.getByTestId("cxo-card-capacity");
    expect(updated.textContent).not.toContain("A");
    expect(updated.textContent).not.toContain("B");
  });

  it("center selector lists parent centers, not depts", () => {
    const multiParent = {
      產品中心: { label: "產品中心", children: ["工程"] },
      數據平台中心: { label: "數據平台中心", children: ["分析"] },
    };
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      分析: { label: "分析部", members: [], parent: "數據平台中心" },
    };
    render(<CXOView {...baseProps}
      centers={centersMulti}
      parentCenters={multiParent}
      members={["A"]} />);
    const parentSel = screen.getByTestId("cxo-parent-filter") as HTMLSelectElement;
    const optionValues = Array.from(parentSel.options).map(o => o.value);
    expect(optionValues).toContain("all");
    expect(optionValues).toContain("產品中心");
    expect(optionValues).toContain("數據平台中心");
    // Dept keys should NOT appear in parent selector
    expect(optionValues).not.toContain("工程");
    expect(optionValues).not.toContain("分析");
  });

  it("dept selector appears only when parent !== all", () => {
    render(<CXOView {...baseProps} />);
    // Before any selection: parent is "all", dept selector hidden
    expect(screen.queryByTestId("cxo-dept-filter")).toBeNull();
    // Pick parent center
    const parentSel = screen.getByTestId("cxo-parent-filter") as HTMLSelectElement;
    fireEvent.change(parentSel, { target: { value: "產品中心" } });
    // Dept selector now visible
    expect(screen.getByTestId("cxo-dept-filter")).toBeInTheDocument();
  });

  it("selecting a parent center narrows Card 1B (dept ROI) to its children", () => {
    const multiParent = {
      產品中心: { label: "產品中心", children: ["工程"] },
      數據平台中心: { label: "數據平台中心", children: ["分析"] },
    };
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      分析: { label: "分析部", members: ["D"], parent: "數據平台中心" },
    };
    const rawMulti = {
      "3/13": {
        A: { total: 8, meeting: 1, dev: 7 },
        D: { total: 7, meeting: 1, dev: 6 },
      },
    };
    render(<CXOView {...baseProps}
      centers={centersMulti}
      parentCenters={multiParent}
      rawData={rawMulti}
      members={["A", "D"]}
      dates={["3/13"]} />);
    // Default "all" shows both
    const card1Before = screen.getByTestId("cxo-card-roi-dept");
    expect(card1Before.textContent).toContain("工程部");
    expect(card1Before.textContent).toContain("分析部");
    // Select 數據平台中心
    const parentSel = screen.getByTestId("cxo-parent-filter") as HTMLSelectElement;
    fireEvent.change(parentSel, { target: { value: "數據平台中心" } });
    const card1After = screen.getByTestId("cxo-card-roi-dept");
    expect(card1After.textContent).toContain("分析部");
    expect(card1After.textContent).not.toContain("工程部");
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
