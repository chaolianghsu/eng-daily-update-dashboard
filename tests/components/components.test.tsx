// tests/components/components.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardPanel, ColorDot, StatusBadge } from "../../src/components";

describe("CardPanel", () => {
  it("renders title and children", () => {
    render(<CardPanel title="Test Title"><p>Content</p></CardPanel>);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });
});

describe("ColorDot", () => {
  it("renders with given color", () => {
    const { container } = render(<ColorDot color="#ff0000" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toBe("rgb(255, 0, 0)");
  });
});

describe("StatusBadge", () => {
  it("renders label with correct colors", () => {
    render(<StatusBadge status={{ label: "合理", color: "#22c55e", bg: "#166534" }} />);
    expect(screen.getByText("合理")).toBeInTheDocument();
  });
});
