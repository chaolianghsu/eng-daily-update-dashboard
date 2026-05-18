import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCenterFilter } from "../../../src/hooks/useCenterFilter";

const MEMBERS = ["Joyce", "Ivy", "Alice", "Bob"];

const CENTERS = {
  工程: { label: "工程部", members: ["Joyce", "Ivy"], parent: "產品中心" },
  產品: { label: "產品部", members: ["Alice"], parent: "產品中心" },
  技發: { label: "技術發展部", members: ["Bob"], parent: "產品中心" },
};

const PARENT_CENTERS = {
  產品中心: { label: "產品中心", children: ["工程", "技發", "產品"] },
  數據平台中心: { label: "數據平台中心", children: ["分析調查一"] },
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

  describe("parent center selection (4th arg)", () => {
    it("returns union of members across all child departments of a parent", () => {
      const { result } = renderHook(() =>
        useCenterFilter(MEMBERS, CENTERS, "產品中心", PARENT_CENTERS)
      );
      // 工程 = [Joyce, Ivy] ∪ 技發 = [Bob] ∪ 產品 = [Alice]
      expect(result.current).toEqual(["Joyce", "Ivy", "Alice", "Bob"]);
    });

    it("returns [] for a parent center whose children have no members", () => {
      const { result } = renderHook(() =>
        useCenterFilter(MEMBERS, CENTERS, "數據平台中心", PARENT_CENTERS)
      );
      expect(result.current).toEqual([]);
    });

    it("dept-level selection still works when parentCenters is supplied", () => {
      const { result } = renderHook(() =>
        useCenterFilter(MEMBERS, CENTERS, "工程", PARENT_CENTERS)
      );
      expect(result.current).toEqual(["Joyce", "Ivy"]);
    });

    it('"all" returns all members when parentCenters supplied', () => {
      const { result } = renderHook(() =>
        useCenterFilter(MEMBERS, CENTERS, "all", PARENT_CENTERS)
      );
      expect(result.current).toEqual(MEMBERS);
    });

    it("returns [] for an unknown key when parentCenters supplied", () => {
      const { result } = renderHook(() =>
        useCenterFilter(MEMBERS, CENTERS, "unknown", PARENT_CENTERS)
      );
      expect(result.current).toEqual([]);
    });

    it("backward compat: omitting parentCenters keeps dept-level behavior", () => {
      const { result } = renderHook(() =>
        useCenterFilter(MEMBERS, CENTERS, "產品中心")
      );
      // "產品中心" isn't a dept key → matches no dept → []
      expect(result.current).toEqual([]);
    });
  });
});
