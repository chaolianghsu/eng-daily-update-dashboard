import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import { MemberView } from "../../src/views/MemberView";

const baseProps = {
  rawData: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`3/${i + 1}`, {
      A: { total: 8, meeting: 1, dev: 7 },
      B: { total: 7, meeting: 2, dev: 5 },
    }])
  ),
  members: ["A", "B"],
  memberColors: { A: "#f472b6", B: "#60a5fa" },
  dates: Array.from({ length: 20 }, (_, i) => `3/${i + 1}`),
  commitData: { commits: {}, analysis: {}, projectRisks: [] },
  leave: {},
  taskAnalysisData: null,
  healthAlerts: [],
  isMobile: false,
};

describe("MemberView", () => {
  it("renders member selector pills", () => {
    render(<MemberView {...baseProps} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("switches member on pill click", () => {
    render(<MemberView {...baseProps} />);
    fireEvent.click(screen.getByText("B"));
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders 4 profile cards", () => {
    const { container } = render(<MemberView {...baseProps} />);
    const cards = container.querySelectorAll("[data-testid^='profile-card-']");
    expect(cards).toHaveLength(4);
  });

  it("shows alert banner for member with health alerts", () => {
    const props = {
      ...baseProps,
      healthAlerts: [
        { member: "A", severity: "🔴" as const, text: "連續低工時 (3天)", source: "trend" as const, type: "consecutive_low" as const },
      ],
    };
    render(<MemberView {...props} />);
    expect(screen.getByText("連續低工時 (3天)")).toBeInTheDocument();
  });

  it("does not show alert banner when member has no alerts", () => {
    render(<MemberView {...baseProps} />);
    expect(screen.queryByTestId("alert-banner")).not.toBeInTheDocument();
  });

  it("shows severity badge on member pills with alerts", () => {
    const props = {
      ...baseProps,
      healthAlerts: [
        { member: "A", severity: "🔴" as const, text: "test", source: "trend" as const, type: "hours_drop" as const },
      ],
    };
    render(<MemberView {...props} />);
    expect(screen.getByText("🔴")).toBeInTheDocument();
  });

  it("defaults to first member with alert", () => {
    const props = {
      ...baseProps,
      healthAlerts: [
        { member: "B", severity: "🟡" as const, text: "test alert", source: "trend" as const, type: "commit_drop" as const },
      ],
    };
    render(<MemberView {...props} />);
    expect(screen.getByText("test alert")).toBeInTheDocument();
  });
});
