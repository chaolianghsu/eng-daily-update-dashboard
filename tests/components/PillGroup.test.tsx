// tests/components/PillGroup.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PillGroup } from "../../src/components/PillGroup";

describe("PillGroup", () => {
  const items = [
    { key: "a", label: "Alpha" },
    { key: "b", label: "Beta" },
    { key: "c", label: "Gamma" },
  ];

  it("renders all pill labels", () => {
    render(<PillGroup items={items} activeKey="a" onSelect={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("highlights the active pill", () => {
    const { container } = render(<PillGroup items={items} activeKey="b" onSelect={() => {}} />);
    const activeBtn = screen.getByText("Beta").closest("button");
    expect(activeBtn?.style.background).toContain("#334155");
  });

  it("calls onSelect with the clicked key", () => {
    const onSelect = vi.fn();
    render(<PillGroup items={items} activeKey="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Gamma"));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("renders badge when provided", () => {
    const itemsWithBadge = [
      { key: "a", label: "Alpha" },
      { key: "b", label: "Beta", badge: 5, badgeColor: "#06b6d4" },
    ];
    render(<PillGroup items={itemsWithBadge} activeKey="a" onSelect={() => {}} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not render badge when badge is 0", () => {
    const itemsWithZero = [
      { key: "a", label: "Alpha", badge: 0, badgeColor: "#06b6d4" },
    ];
    render(<PillGroup items={itemsWithZero} activeKey="a" onSelect={() => {}} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
