// tests/components/TrendView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { TrendView } from "../../src/views/TrendView";

const baseProps = {
  trendRange: "2weeks",
  onTrendRangeChange: vi.fn(),
  trendDates: ["3/9", "3/10"],
  trendData: [{ date: "3/9（一）", A: 8, "團隊平均": 8 }],
  useWeeklyAgg: false,
  weekGroups: [],
  members: ["A"],
  memberColors: { A: "#f472b6" },
  selectedMembers: new Set<string>(),
  onToggleMember: vi.fn(),
  onClearMembers: vi.fn(),
  isMobile: false,
  commitData: null,
  rawData: { "3/9": { A: { total: 8 } } },
  leave: {},
};

describe("TrendView", () => {
  it("renders time range buttons", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText("1週")).toBeInTheDocument();
    expect(screen.getByText("2週")).toBeInTheDocument();
    expect(screen.getByText("1月")).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
  });

  it("renders member chips", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows clear button when members selected", () => {
    const props = { ...baseProps, selectedMembers: new Set(["A"]) };
    render(<TrendView {...props} />);
    expect(screen.getByText("清除")).toBeInTheDocument();
  });

  it("renders daily table when useWeeklyAgg is false", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText("成員")).toBeInTheDocument();
    expect(screen.getByText("平均")).toBeInTheDocument();
    expect(screen.getByText("穩定度")).toBeInTheDocument();
  });

  it("renders weekly table when useWeeklyAgg is true", () => {
    const props = {
      ...baseProps,
      useWeeklyAgg: true,
      weekGroups: [{ key: "3/9", label: "3/9–3/13", dates: ["3/9", "3/10"] }],
    };
    render(<TrendView {...props} />);
    expect(screen.getByText("3/9–3/13")).toBeInTheDocument();
  });

  it("renders date range info", () => {
    render(<TrendView {...baseProps} />);
    expect(screen.getByText(/3\/9.*3\/10/)).toBeInTheDocument();
  });
});
