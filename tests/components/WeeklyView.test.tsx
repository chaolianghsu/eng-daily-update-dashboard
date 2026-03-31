// tests/components/WeeklyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { WeeklyView } from "../../src/views/WeeklyView";

const baseProps = {
  weeklySummary: [
    { name: "A", avg: 8, sum: 40, devAvg: 6, meetAvg: 2, daysReported: 5, meetSum: 10, meetPct: 25, trend: "➡️", stdDev: 0.5, stabilityPct: 83, stabilityColor: "#22c55e", commitTotal: 0, commitAvg: 0, consistency: { ok: 0, warn: 0, red: 0 } },
  ],
  chartHeight: 380,
  members: ["A"],
  memberColors: { A: "#f472b6" },
  selectedMembers: new Set<string>(),
  onToggleMember: vi.fn(),
  isMobile: false,
  dates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
  commitData: null,
  leave: {},
  dailyDates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
  dayLabels: { "3/9": "一", "3/10": "二", "3/11": "三", "3/12": "四", "3/13": "五" },
  onDateSelect: vi.fn(),
};

describe("WeeklyView", () => {
  it("renders table headers", () => {
    render(<WeeklyView {...baseProps} />);
    expect(screen.getByText("成員")).toBeInTheDocument();
    expect(screen.getByText("回報")).toBeInTheDocument();
    expect(screen.getByText("日均")).toBeInTheDocument();
  });

  it("renders member stats", () => {
    render(<WeeklyView {...baseProps} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument(); // daysReported/total
  });

  it("shows meeting warning when meetPct > 50", () => {
    const props = {
      ...baseProps,
      weeklySummary: [
        { ...baseProps.weeklySummary[0], meetPct: 60 },
      ],
    };
    render(<WeeklyView {...props} />);
    expect(screen.getByText(/60%.*⚠/)).toBeInTheDocument();
  });

  it("renders commit columns when commit data present", () => {
    const props = {
      ...baseProps,
      weeklySummary: [
        { ...baseProps.weeklySummary[0], commitTotal: 31, commitAvg: 6.2, consistency: { ok: 5, warn: 0, red: 0 } },
      ],
    };
    render(<WeeklyView {...props} />);
    expect(screen.getByText("Commits")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getByText("6.2")).toBeInTheDocument();
  });

  it("renders stability bar", () => {
    const { container } = render(<WeeklyView {...baseProps} />);
    // stabilityColor is green (#22c55e), should be visible
    const stabilityText = screen.getByText("0.5"); // stdDev value
    expect(stabilityText).toBeInTheDocument();
  });

  it("renders consistency heatmap when commitData provided", () => {
    const props = {
      ...baseProps,
      commitData: {
        commits: { "3/9": { "A": { count: 5, projects: ["p1"], items: [] } } },
        analysis: { "3/9": { "A": { status: "✅", commitCount: 5, hours: 8 } } },
        projectRisks: [],
      },
    };
    render(<WeeklyView {...props} />);
    expect(screen.getByText("一致性總覽（全期間）")).toBeInTheDocument();
  });

  it("does not render heatmap when commitData is null", () => {
    render(<WeeklyView {...baseProps} />);
    expect(screen.queryByText("一致性總覽（全期間）")).not.toBeInTheDocument();
  });
});
