// tests/components/DailyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { DailyView } from "../../src/views/DailyView";

const baseProps = {
  dailyDates: ["3/9", "3/10"],
  activeDate: "3/10",
  onDateSelect: vi.fn(),
  dayLabels: { "3/9": "一", "3/10": "二" },
  weekLabel: "本週 3/9 – 3/13",
  dailyBarData: [
    { name: "Alice", 開發: 6, 會議: 2, total: 8 },
    { name: "Bob", 開發: 5, 會議: 1, total: 6 },
  ],
  chartHeight: 380,
  memberColors: { Alice: "#f472b6", Bob: "#a78bfa" },
  issueMap: {},
  commitData: null,
  leave: {},
};

describe("DailyView", () => {
  it("renders date buttons", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getAllByText(/3\/9/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/3\/10/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders member cards", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows week label", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("本週 3/9 – 3/13")).toBeInTheDocument();
  });

  it("active date button has accent border", () => {
    const { container } = render(<DailyView {...baseProps} />);
    const buttons = container.querySelectorAll(".date-btn");
    const activeBtn = Array.from(buttons).find(b => b.textContent?.includes("3/10"));
    expect(activeBtn).toBeDefined();
    expect((activeBtn as HTMLElement).style.border).toContain("59, 130, 246"); // COLORS.accent rgb
  });

  it("shows '未報' for unreported members", () => {
    const props = {
      ...baseProps,
      dailyBarData: [
        { name: "A", 開發: null, 會議: null, total: null, status: 'unreported' as const },
      ],
    };
    render(<DailyView {...props} />);
    expect(screen.getByText("未報")).toBeInTheDocument();
  });

  it("shows '無工時' for replied_no_hours members", () => {
    const props = {
      ...baseProps,
      dailyBarData: [
        { name: "A", 開發: null, 會議: null, total: null, status: 'replied_no_hours' as const },
      ],
    };
    render(<DailyView {...props} />);
    expect(screen.getByText("無工時")).toBeInTheDocument();
  });
});
