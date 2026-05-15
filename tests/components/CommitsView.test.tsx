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
    // cells[0] is source icon, cells[1] is time
    expect(cells[1].textContent).toBe("—");
  });
});

describe("CommitsView center filter compliance", () => {
  const commitDataMulti = {
    commits: {
      "3/18": {
        Joyce: {
          count: 2,
          projects: ["projA"],
          items: [
            { title: "Joyce fix", sha: "j1", project: "projA", url: "u/j1" },
            { title: "Joyce feat", sha: "j2", project: "projA", url: "u/j2" },
          ],
        },
        Richard: {
          count: 1,
          projects: ["projB"],
          items: [{ title: "Richard chore", sha: "r1", project: "projB", url: "u/r1" }],
        },
      },
    },
    analysis: {
      "3/18": {
        Joyce: { status: "✅", commitCount: 2, hours: 8 },
        Richard: { status: "✅", commitCount: 1, hours: 8 },
      },
    },
    projectRisks: [],
  };

  const taskAnalysisDataMulti = {
    analysisDate: "2026-03-18",
    period: "3/18-3/18",
    warnings: [
      { date: "3/18", member: "Joyce", severity: "🔴", type: "low_output", task: "T1", commits: "j1", reasoning: "x" },
      { date: "3/18", member: "Richard", severity: "🟠", type: "outlier", task: "T2", commits: "r1", reasoning: "y" },
    ],
    summary: { totalWarnings: 2, critical: 1, warning: 0, caution: 1 },
  };

  it("filters task warnings by members", () => {
    const props = {
      ...baseProps,
      commitData: commitDataMulti,
      members: ["Joyce"],
      memberColors: { Joyce: "#f472b6" },
      taskAnalysisData: taskAnalysisDataMulti,
    };
    render(<CommitsView {...props} />);
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.queryByText("T2")).not.toBeInTheDocument();
  });

  it("filters commit detail by members", () => {
    const props = {
      ...baseProps,
      commitData: commitDataMulti,
      members: ["Joyce"],
      memberColors: { Joyce: "#f472b6" },
      taskAnalysisData: null,
    };
    render(<CommitsView {...props} />);
    // 2 commits row for Joyce should exist; Richard should not.
    expect(screen.getByText(/2 commits/)).toBeInTheDocument();
    expect(screen.queryByText(/1 commits/)).not.toBeInTheDocument();
  });

  it("when all members are in filter, behavior unchanged (both rendered)", () => {
    const props = {
      ...baseProps,
      commitData: commitDataMulti,
      members: ["Joyce", "Richard"],
      memberColors: { Joyce: "#f472b6", Richard: "#60a5fa" },
      taskAnalysisData: taskAnalysisDataMulti,
    };
    render(<CommitsView {...props} />);
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText(/2 commits/)).toBeInTheDocument();
    expect(screen.getByText(/1 commits/)).toBeInTheDocument();
  });
});
