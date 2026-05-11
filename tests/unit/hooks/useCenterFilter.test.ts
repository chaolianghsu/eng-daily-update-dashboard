import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCenterFilter } from "../../../src/hooks/useCenterFilter";

const MEMBERS = ["Joyce", "Ivy", "Alice", "Bob"];

const CENTERS = {
  工程: { label: "工程部", members: ["Joyce", "Ivy"] },
  產品: { label: "產品部", members: ["Alice"] },
  技發: { label: "技術發展部", members: ["Bob"] },
};

describe("useCenterFilter", () => {
  it('returns all members when selected is "all"', () => {
    const { result } = renderHook(() => useCenterFilter(MEMBERS, CENTERS, "all"));
    expect(result.current).toEqual(MEMBERS);
  });

  it("filters to a specific center's members", () => {
    const { result } = renderHook(() => useCenterFilter(MEMBERS, CENTERS, "工程"));
    expect(result.current).toEqual(["Joyce", "Ivy"]);
  });

  it("returns an empty list when the center has no overlap with current members", () => {
    const { result } = renderHook(() =>
      useCenterFilter(MEMBERS, CENTERS, "技發")
    );
    expect(result.current).toEqual(["Bob"]);
  });

  it("returns the full member list (no filter) when centers is undefined — backward compat", () => {
    const { result } = renderHook(() => useCenterFilter(MEMBERS, undefined, "工程"));
    expect(result.current).toEqual(MEMBERS);
  });

  it("returns an empty list when selecting a center that does not exist", () => {
    const { result } = renderHook(() =>
      useCenterFilter(MEMBERS, CENTERS, "nonexistent")
    );
    expect(result.current).toEqual([]);
  });

  it("preserves original member order from input array", () => {
    const reordered = ["Bob", "Alice", "Ivy", "Joyce"];
    const { result } = renderHook(() =>
      useCenterFilter(reordered, CENTERS, "工程")
    );
    expect(result.current).toEqual(["Ivy", "Joyce"]);
  });
});
