// tests/components/CommitsView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("recharts", () => import("../__mocks__/recharts"));

import CommitsView from "../../src/CommitsView";

const baseProps = {
  commitData: {
    commits: {} as any,
    analysis: {} as any,
    projectRisks: [],
  },
  dates: ["3/18"],
  members: ["Alice"],
  memberColors: { Alice: "#f472b6" },
  leave: {},
  activeDate: "3/18",
  onDateSelect: vi.fn(),
  dailyDates: ["3/18"],
  dayLabels: { "3/18": "三" },
  taskAnalysisData: null,
};

describe("CommitsView commit detail time display", () => {
  it("shows HH:MM when datetime is present", () => {
    const props = {
      ...baseProps,
      commitData: {
        commits: {
          "3/18": {
            Alice: {
              count: 1,
              projects: ["myproject"],
              items: [
                {
                  title: "fix bug",
                  sha: "abc1234",
                  project: "myproject",
                  url: "https://example.com/abc1234",
                  datetime: "2026-03-18T15:30:45+08:00",
                },
              ],
            },
          },
        },
        analysis: {
          "3/18": {
            Alice: { status: "✅", commitCount: 1, hours: 8 },
          },
        },
        projectRisks: [],
      },
    };

    render(<CommitsView {...props} />);

    // Click the expand button for Alice
    const expandBtn = screen.getByText(/1 commits/);
    fireEvent.click(expandBtn);

    // Should show the formatted time 15:30
    expect(screen.getByText("15:30")).toBeInTheDocument();
  });

  it("shows dash when datetime is missing", () => {
    const props = {
      ...baseProps,
      commitData: {
        commits: {
          "3/18": {
            Alice: {
              count: 1,
              projects: ["myproject"],
              items: [
                {
                  title: "fix bug",
                  sha: "abc1234",
                  project: "myproject",
                  url: "https://example.com/abc1234",
                  // no datetime field
                },
              ],
            },
          },
        },
        analysis: {
          "3/18": {
            Alice: { status: "✅", commitCount: 1, hours: 8 },
          },
        },
        projectRisks: [],
      },
    };

    render(<CommitsView {...props} />);

    // Click the expand button for Alice
    const expandBtn = screen.getByText(/1 commits/);
    fireEvent.click(expandBtn);

    // The first <td> in the commit row should show a dash
    // Find the commit row by sha text, then check sibling
    const commitRow = screen.getByText("fix bug").closest("tr");
    expect(commitRow).toBeTruthy();
    const cells = commitRow!.querySelectorAll("td");
    expect(cells[0].textContent).toBe("—");
  });
});
