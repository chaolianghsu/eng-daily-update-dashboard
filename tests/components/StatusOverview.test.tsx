// tests/components/StatusOverview.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { StatusOverview } from "../../src/views/StatusOverview";

const baseProps = {
  allIssues: [],
  issues: [],
  members: ["A", "B"],
  rawData: { "3/5": { A: { total: 8 }, B: { total: 7 } } },
  dates: ["3/5"],
};

describe("StatusOverview", () => {
  it("shows 全員狀態正常 when no issues", () => {
    render(<StatusOverview {...baseProps} />);
    expect(screen.getByText("全員狀態正常")).toBeInTheDocument();
  });

  it("shows reporting rate", () => {
    render(<StatusOverview {...baseProps} />);
    expect(screen.getByText("2")).toBeInTheDocument(); // reportedCount
    expect(screen.getByText(/\/2/)).toBeInTheDocument(); // /total
  });

  it("shows attention count with issues", () => {
    const props = {
      ...baseProps,
      allIssues: [{ member: "A", severity: "🔴", text: "超時" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("1")).toBeInTheDocument(); // attention count
  });

  it("renders attention card with member name and text", () => {
    const props = {
      ...baseProps,
      allIssues: [{ member: "A", severity: "🔴", text: "超時" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("超時")).toBeInTheDocument();
  });

  it("renders team average", () => {
    render(<StatusOverview {...baseProps} />);
    expect(screen.getByText("7.5")).toBeInTheDocument(); // (8+7)/2
  });

  it("renders stable members section when green issues exist", () => {
    const props = {
      ...baseProps,
      issues: [{ member: "B", severity: "🟢", text: "穩定" }],
    };
    render(<StatusOverview {...props} />);
    expect(screen.getByText("穩定")).toBeInTheDocument();
  });
});
