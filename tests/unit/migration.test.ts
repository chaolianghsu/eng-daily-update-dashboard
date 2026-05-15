// tests/unit/migration.test.ts
import { describe, it, expect } from "vitest";
import { migrateToParentCenters } from "../../scripts/migrate-to-parent-centers.js";

describe("migrateToParentCenters", () => {
  it("adds parent='產品中心' to existing 工程 and 技發 departments", () => {
    const input = {
      rawData: {},
      centers: {
        工程: { label: "工程部", members: ["A"] },
        技發: { label: "技術發展部", members: ["B"] },
      },
    };
    const result = migrateToParentCenters(input);
    expect(result.centers.工程.parent).toBe("產品中心");
    expect(result.centers.技發.parent).toBe("產品中心");
  });

  it("creates a parentCenters block with 產品中心 containing both known depts", () => {
    const input = {
      rawData: {},
      centers: {
        工程: { label: "工程部", members: [] },
        技發: { label: "技術發展部", members: [] },
      },
    };
    const result = migrateToParentCenters(input);
    expect(result.parentCenters).toBeDefined();
    expect(result.parentCenters["產品中心"]).toBeDefined();
    expect(result.parentCenters["產品中心"].label).toBe("產品中心");
    expect(result.parentCenters["產品中心"].children).toContain("工程");
    expect(result.parentCenters["產品中心"].children).toContain("技發");
  });

  it("is idempotent — re-running does not duplicate children or overwrite", () => {
    const input = {
      rawData: {},
      centers: {
        工程: { label: "工程部", members: [], parent: "產品中心" },
        技發: { label: "技術發展部", members: [], parent: "產品中心" },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程", "技發"] },
      },
    };
    const once = migrateToParentCenters(input);
    const twice = migrateToParentCenters(once);
    expect(twice.parentCenters["產品中心"].children).toEqual(["工程", "技發"]);
    expect(twice.centers.工程.parent).toBe("產品中心");
  });

  it("preserves existing parent value if already set to a different center", () => {
    const input = {
      rawData: {},
      centers: {
        分析調查一: { label: "分析調查部(一)", members: [], parent: "數據平台中心" },
        工程: { label: "工程部", members: [] },
      },
      parentCenters: {
        數據平台中心: { label: "數據平台中心", children: ["分析調查一"] },
      },
    };
    const result = migrateToParentCenters(input);
    expect(result.centers.分析調查一.parent).toBe("數據平台中心");
    // 工程 (a known product-center dept) → 產品中心
    expect(result.centers.工程.parent).toBe("產品中心");
    expect(result.parentCenters["數據平台中心"].children).toEqual(["分析調查一"]);
    expect(result.parentCenters["產品中心"].children).toContain("工程");
  });

  it("handles a custom dept (3+) by defaulting unknown ones to 產品中心", () => {
    const input = {
      rawData: {},
      centers: {
        工程: { label: "工程部", members: [] },
        技發: { label: "技術發展部", members: [] },
        產品: { label: "產品部", members: [] },
      },
    };
    const result = migrateToParentCenters(input);
    expect(result.centers.工程.parent).toBe("產品中心");
    expect(result.centers.技發.parent).toBe("產品中心");
    expect(result.centers.產品.parent).toBe("產品中心");
    expect(result.parentCenters["產品中心"].children).toEqual(
      expect.arrayContaining(["工程", "技發", "產品"])
    );
  });

  it("leaves rawData and other top-level fields untouched", () => {
    const input = {
      rawData: { "3/9": { A: { total: 8 } } },
      issues: [{ member: "A", severity: "🟡", text: "x" }],
      leave: { A: [] },
      centers: { 工程: { label: "工程部", members: ["A"] } },
    };
    const result = migrateToParentCenters(input);
    expect(result.rawData).toEqual(input.rawData);
    expect(result.issues).toEqual(input.issues);
    expect(result.leave).toEqual(input.leave);
  });

  it("returns input unchanged when no centers field present", () => {
    const input = { rawData: { "3/9": {} } };
    const result = migrateToParentCenters(input);
    expect(result).toEqual(input);
    expect(result.parentCenters).toBeUndefined();
  });
});
