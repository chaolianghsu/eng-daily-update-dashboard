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

  it("renders parent center row + dept row when parentCenters has 2+ entries", () => {
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
    // Both parent center chips render
    expect(screen.getByRole("button", { name: "產品中心" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "數據平台中心" })).toBeTruthy();
    // All dept chips render too
    expect(screen.getByText("工程部")).toBeTruthy();
    expect(screen.getByText("技發部")).toBeTruthy();
    expect(screen.getByText("分析部")).toBeTruthy();
  });

  it("clicking a parent center chip calls onChange with parent key", () => {
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      分析: { label: "分析部", members: ["C"], parent: "數據平台中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["工程"] },
      數據平台中心: { label: "數據平台中心", children: ["分析"] },
    };
    const onChange = vi.fn();
    render(
      <CenterFilter
        centers={centersMulti}
        parentCenters={parentCenters}
        selected="all"
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "數據平台中心" }));
    expect(onChange).toHaveBeenCalledWith("數據平台中心");
  });

  it("when a parent center is selected, only its child depts are shown", () => {
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
        selected="數據平台中心"
        onChange={() => {}}
      />
    );
    expect(screen.queryByText("工程部")).toBeNull();
    expect(screen.queryByText("技發部")).toBeNull();
    expect(screen.getByText("分析部")).toBeTruthy();
  });

  it("when a dept is selected, its parent chip is also highlighted", () => {
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
        selected="工程"
        onChange={() => {}}
      />
    );
    // Dept selected → siblings still visible
    expect(screen.getByText("工程部")).toBeTruthy();
    expect(screen.getByText("技發部")).toBeTruthy();
    // Other-parent dept hidden
    expect(screen.queryByText("分析部")).toBeNull();
    // Parent chip carries data-parent-active marker
    const parentBtn = screen.getByRole("button", { name: "產品中心" });
    expect(parentBtn.getAttribute("data-parent-active")).toBe("true");
    // Dept chip carries data-active
    const deptBtn = screen.getByRole("button", { name: "工程部" });
    expect(deptBtn.getAttribute("data-active")).toBe("true");
  });

  it("placeholder dept (members=[]) renders dimmed with 尚未啟用 title", () => {
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      產品: { label: "產品部", members: [], parent: "產品中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["工程", "產品"] },
    };
    render(
      <CenterFilter
        centers={centersMulti}
        parentCenters={parentCenters}
        selected="all"
        onChange={() => {}}
      />
    );
    const placeholderBtn = screen.getByRole("button", { name: "產品部" });
    expect(placeholderBtn.title).toMatch(/尚未啟用/);
    // Has dim style: check inline style opacity
    expect((placeholderBtn as HTMLElement).style.opacity).toBe("0.55");
  });

  it("placeholder dept is still clickable", () => {
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      產品: { label: "產品部", members: [], parent: "產品中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["工程", "產品"] },
    };
    const onChange = vi.fn();
    render(
      <CenterFilter
        centers={centersMulti}
        parentCenters={parentCenters}
        selected="all"
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "產品部" }));
    expect(onChange).toHaveBeenCalledWith("產品");
  });

  it("orders dept chips by parentCenter.children sequence", () => {
    const centersMulti = {
      工程: { label: "工程部", members: ["A"], parent: "產品中心" },
      技發: { label: "技發部", members: ["B"], parent: "產品中心" },
    };
    const parentCenters = {
      產品中心: { label: "產品中心", children: ["技發", "工程"] }, // reversed
    };
    const { container } = render(
      <CenterFilter
        centers={centersMulti}
        parentCenters={parentCenters}
        selected="all"
        onChange={() => {}}
      />
    );
    const labels = Array.from(container.querySelectorAll("[data-dept-chip]")).map(
      b => b.textContent
    );
    expect(labels).toEqual(["技發部", "工程部"]);
  });

  it("backward compat: with no parentCenters, falls back to flat layout", () => {
    const { container } = render(
      <CenterFilter centers={CENTERS} selected="all" onChange={() => {}} />
    );
    // No data-parent-chip elements; flat single-row layout
    expect(container.querySelector("[data-parent-chip]")).toBeNull();
    expect(screen.getByText("全部")).toBeTruthy();
    expect(screen.getByText("工程部")).toBeTruthy();
    expect(screen.getByText("產品部")).toBeTruthy();
  });
});
