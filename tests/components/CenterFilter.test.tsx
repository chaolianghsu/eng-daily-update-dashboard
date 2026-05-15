import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CenterFilter } from "../../src/components/CenterFilter";

const CENTERS = {
  工程: { label: "工程部", members: ["Joyce", "Ivy"] },
  產品: { label: "產品部", members: ["Alice"] },
};

describe("CenterFilter", () => {
  it("renders 全部 + each center label as buttons", () => {
    render(<CenterFilter centers={CENTERS} selected="all" onChange={() => {}} />);
    expect(screen.getByText("全部")).toBeTruthy();
    expect(screen.getByText("工程部")).toBeTruthy();
    expect(screen.getByText("產品部")).toBeTruthy();
  });

  it("calls onChange with the center key when a chip is clicked", () => {
    const onChange = vi.fn();
    render(<CenterFilter centers={CENTERS} selected="all" onChange={onChange} />);
    fireEvent.click(screen.getByText("工程部"));
    expect(onChange).toHaveBeenCalledWith("工程");
  });

  it("renders nothing when centers is undefined (backward compat)", () => {
    const { container } = render(
      <CenterFilter centers={undefined} selected="all" onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when centers is an empty object", () => {
    const { container } = render(
      <CenterFilter centers={{}} selected="all" onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows group label headers when parentCenters has 2+ entries", () => {
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      技發: { label: "技發部", members: ["B"], parent: "產品中心" },
      分析: { label: "分析部", members: ["C"], parent: "數據平台中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["工程", "技發"] },
      數據平台中心: { label: "數據平台中心", children: ["分析"] },
    };
    render(
      <CenterFilter
        centers={centersMulti}
        parentCenters={parentCenters}
        selected="all"
        onChange={() => {}}
      />
    );
    // group labels visible
    expect(screen.getByText(/產品中心/)).toBeTruthy();
    expect(screen.getByText(/數據平台中心/)).toBeTruthy();
    // dept chips also visible
    expect(screen.getByText("工程部")).toBeTruthy();
    expect(screen.getByText("分析部")).toBeTruthy();
  });

  it("renders flat (no group label) when parentCenters has only 1 entry", () => {
    const centersSingle = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      技發: { label: "技發部", members: ["B"], parent: "產品中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["工程", "技發"] },
    };
    const { container } = render(
      <CenterFilter
        centers={centersSingle}
        parentCenters={parentCenters}
        selected="all"
        onChange={() => {}}
      />
    );
    // No group header rendered (just chips)
    expect(container.querySelector("[data-group-label]")).toBeNull();
    expect(screen.getByText("工程部")).toBeTruthy();
    expect(screen.getByText("技發部")).toBeTruthy();
  });

  it("orders chips by parentCenter.children sequence when parentCenters present", () => {
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      技發: { label: "技發部", members: ["B"], parent: "產品中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["技發", "工程"] }, // reversed order
    };
    const { container } = render(
      <CenterFilter
        centers={centersMulti}
        parentCenters={parentCenters}
        selected="all"
        onChange={() => {}}
      />
    );
    const chipLabels = Array.from(container.querySelectorAll("button")).map(b => b.textContent);
    // 全部 first, then 技發部, then 工程部
    expect(chipLabels).toEqual(["全部", "技發部", "工程部"]);
  });
});
