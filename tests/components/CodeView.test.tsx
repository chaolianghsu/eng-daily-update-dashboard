import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodeView } from "../../src/views/CodeView";

const I = (code: string | null, hours: number) => ({ code, task: "x", hours });
const E = (items: any[]) => ({ total: 0, meeting: 0, dev: 0, status: "reported" as const, items });

describe("CodeView", () => {
  it("renders empty-state hint when no items data exists", () => {
    const rawData = { "5/1": { Joyce: { total: 8, meeting: 0, dev: 8, status: "reported" as const } } };
    render(<CodeView rawData={rawData} validCodes={undefined} members={["Joyce"]} dates={["5/1"]} commitData={null} />);
    expect(screen.getByText(/尚無 \[CODE\] 標記/)).toBeTruthy();
  });

  it("lists each code with hours and member count", () => {
    const rawData = {
      "5/8": {
        Joyce: E([I("KEYPO", 3)]),
        Ivy: E([I("KEYPO", 2), I("BDE", 1)]),
      },
    };
    render(
      <CodeView
        rawData={rawData}
        validCodes={{ KEYPO: { label: "KEYPO 系列", category: "product" } }}
        members={["Joyce", "Ivy"]}
        dates={["5/8"]}
        commitData={null}
      />
    );
    expect(screen.getByText(/KEYPO 系列/)).toBeTruthy();
    expect(screen.getByText(/BDE/)).toBeTruthy();
    expect(screen.getByText("product")).toBeTruthy();
  });

  it("does not show commit count when commitData is null", () => {
    const rawData = { "5/8": { Joyce: E([I("KEYPO", 3)]) } };
    render(
      <CodeView
        rawData={rawData}
        validCodes={{
          KEYPO: { label: "KEYPO", gitlabProjectPrefixes: ["KEYPO/"] },
        }}
        members={["Joyce"]}
        dates={["5/8"]}
        commitData={null}
      />
    );
    expect(screen.queryByText(/commits/)).toBeNull();
  });

  it("shows uncategorized as 未分類 with orange accent", () => {
    const rawData = { "5/8": { Joyce: E([I(null, 4)]) } };
    render(
      <CodeView rawData={rawData} validCodes={undefined} members={["Joyce"]} dates={["5/8"]} commitData={null} />
    );
    expect(screen.getByText(/未分類/)).toBeTruthy();
  });
});
