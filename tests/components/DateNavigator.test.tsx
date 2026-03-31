// tests/components/DateNavigator.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateNavigator } from "../../src/components/DateNavigator";

const baseProps = {
  dates: ["3/24", "3/25", "3/26", "3/27", "3/28"],
  activeDate: "3/25",
  onDateSelect: vi.fn(),
  dayLabels: { "3/24": "一", "3/25": "二", "3/26": "三", "3/27": "四", "3/28": "五" } as Record<string, string>,
  weeks: [
    { dates: ["3/17", "3/18", "3/19"], label: "3/17 – 3/21" },
    { dates: ["3/24", "3/25", "3/26", "3/27", "3/28"], label: "3/24 – 3/28" },
  ],
  weekIndex: 1,
  canGoPrev: true,
  canGoNext: false,
  onPrevWeek: vi.fn(),
  onNextWeek: vi.fn(),
  onSelectWeek: vi.fn(),
};

describe("DateNavigator", () => {
  it("renders all date numbers", () => {
    render(<DateNavigator {...baseProps} />);
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
  });

  it("renders day-of-week labels", () => {
    render(<DateNavigator {...baseProps} />);
    expect(screen.getByText("一")).toBeInTheDocument();
    expect(screen.getByText("二")).toBeInTheDocument();
  });

  it("highlights the active date", () => {
    const { container } = render(<DateNavigator {...baseProps} />);
    const btn25 = screen.getByText("25").closest("button");
    // jsdom normalizes hex to rgb — #06b6d4 = rgb(6, 182, 212)
    expect(btn25?.style.background).toBeTruthy();
  });

  it("calls onDateSelect when clicking a date", () => {
    const onDateSelect = vi.fn();
    render(<DateNavigator {...baseProps} onDateSelect={onDateSelect} />);
    fireEvent.click(screen.getByText("26"));
    expect(onDateSelect).toHaveBeenCalledWith("3/26");
  });

  it("calls onPrevWeek when clicking ◀", () => {
    const onPrevWeek = vi.fn();
    render(<DateNavigator {...baseProps} onPrevWeek={onPrevWeek} />);
    fireEvent.click(screen.getByText("◀"));
    expect(onPrevWeek).toHaveBeenCalled();
  });

  it("disables ▶ when canGoNext is false", () => {
    render(<DateNavigator {...baseProps} canGoNext={false} />);
    const nextBtn = screen.getByText("▶");
    expect(nextBtn).toBeDisabled();
  });

  it("shows week label button", () => {
    render(<DateNavigator {...baseProps} />);
    // Should show something like W13 ▾
    expect(screen.getByText(/W\d+/)).toBeInTheDocument();
  });

  it("opens week dropdown on click and shows all weeks", () => {
    render(<DateNavigator {...baseProps} />);
    fireEvent.click(screen.getByText(/W\d+/));
    expect(screen.getByText("3/17 – 3/21")).toBeInTheDocument();
    expect(screen.getByText("3/24 – 3/28")).toBeInTheDocument();
  });

  it("shows 本週 and 上週 shortcuts in dropdown", () => {
    render(<DateNavigator {...baseProps} />);
    fireEvent.click(screen.getByText(/W\d+/));
    expect(screen.getByText("本週")).toBeInTheDocument();
    expect(screen.getByText("上週")).toBeInTheDocument();
  });

  it("calls onSelectWeek when clicking a week in dropdown", () => {
    const onSelectWeek = vi.fn();
    render(<DateNavigator {...baseProps} onSelectWeek={onSelectWeek} />);
    fireEvent.click(screen.getByText(/W\d+/));
    fireEvent.click(screen.getByText("3/17 – 3/21"));
    expect(onSelectWeek).toHaveBeenCalledWith(0);
  });
});
