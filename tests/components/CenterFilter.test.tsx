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
});
