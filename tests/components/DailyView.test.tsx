// tests/components/DailyView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { DailyView } from "../../src/views/DailyView";

const baseProps = {
  activeDate: "3/10",
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
  it("renders member cards", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders chart panel title with activeDate", () => {
    render(<DailyView {...baseProps} />);
    expect(screen.getByText(/3\/10 個人工時/)).toBeInTheDocument();
  });
});
