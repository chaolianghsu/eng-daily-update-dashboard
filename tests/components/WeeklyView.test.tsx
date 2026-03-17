// tests/components/WeeklyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { WeeklyView } from "../../src/views/WeeklyView";

const baseProps = {
  weeklySummary: [
    { name: "A", avg: 8, sum: 40, devAvg: 6, meetAvg: 2, daysReported: 5, meetSum: 10, meetPct: 25, trend: "➡️", stdDev: 0.5, stabilityPct: 83, stabilityColor: "#22c55e" },
  ],
  chartHeight: 380,
  members: ["A"],
  memberColors: { A: "#f472b6" },
  selectedMembers: new Set<string>(),
  onToggleMember: vi.fn(),
  isMobile: false,
  dates: ["3/9", "3/10", "3/11", "3/12", "3/13"],
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

  it("renders stability bar", () => {
    const { container } = render(<WeeklyView {...baseProps} />);
    // stabilityColor is green (#22c55e), should be visible
    const stabilityText = screen.getByText("0.5"); // stdDev value
    expect(stabilityText).toBeInTheDocument();
  });
});
