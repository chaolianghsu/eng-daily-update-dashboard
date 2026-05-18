// tests/unit/expand-org-structure.test.js
import { describe, it, expect } from "vitest";
import { expandOrgStructure } from "../../scripts/expand-org-structure.js";

describe("expandOrgStructure", () => {
  it("adds 產品 department under 產品中心 when missing", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
        技發: { label: "技術發展部", members: ["B"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程", "技發"] },
      },
    };
    const out = expandOrgStructure(data);
    expect(out.centers.產品).toEqual({
      label: "產品部",
      members: [],
      parent: "產品中心",
      validCodes: {},
    });
  });

  it("adds 分析調查一 department under 數據平台中心 when missing", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程"] },
      },
    };
    const out = expandOrgStructure(data);
    expect(out.centers.分析調查一).toEqual({
      label: "分析調查部(一)",
      members: [],
      parent: "數據平台中心",
      validCodes: {},
    });
  });

  it("adds 數據平台中心 parent center when missing", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程"] },
      },
    };
    const out = expandOrgStructure(data);
    expect(out.parentCenters.數據平台中心).toEqual({
      label: "數據平台中心",
      children: ["分析調查一"],
    });
  });

  it("updates 產品中心.children to include 工程, 技發, 產品", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
        技發: { label: "技術發展部", members: ["B"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程", "技發"] },
      },
    };
    const out = expandOrgStructure(data);
    expect(out.parentCenters.產品中心.children).toEqual(["工程", "技發", "產品"]);
  });

  it("is idempotent: re-running does not duplicate children", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
        技發: { label: "技術發展部", members: ["B"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程", "技發"] },
      },
    };
    const first = expandOrgStructure(data);
    const second = expandOrgStructure(first);
    expect(second.parentCenters.產品中心.children).toEqual(["工程", "技發", "產品"]);
    expect(second.parentCenters.數據平台中心.children).toEqual(["分析調查一"]);
    expect(Object.keys(second.centers).sort()).toEqual(
      ["分析調查一", "工程", "技發", "產品"].sort()
    );
  });

  it("does not overwrite existing 產品 or 分析調查一 configs", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
        產品: {
          label: "Custom 產品部",
          members: ["Neil"],
          parent: "產品中心",
          validCodes: { CUSTOM: { label: "custom" } },
        },
        分析調查一: {
          label: "分析調查部(一)-custom",
          members: ["Ana"],
          parent: "數據平台中心",
          validCodes: {},
        },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程", "產品"] },
        數據平台中心: { label: "數據平台中心", children: ["分析調查一"] },
      },
    };
    const out = expandOrgStructure(data);
    expect(out.centers.產品.label).toBe("Custom 產品部");
    expect(out.centers.產品.members).toEqual(["Neil"]);
    expect(out.centers.產品.validCodes.CUSTOM).toBeDefined();
    expect(out.centers.分析調查一.label).toBe("分析調查部(一)-custom");
    expect(out.centers.分析調查一.members).toEqual(["Ana"]);
  });

  it("does not mutate the input object", () => {
    const data = {
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程"] },
      },
    };
    const snapshot = JSON.stringify(data);
    expandOrgStructure(data);
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it("preserves other top-level keys (rawData, issues, leave)", () => {
    const data = {
      rawData: { "3/1": { A: { total: 8, meeting: 1, dev: 7 } } },
      issues: [{ member: "A", severity: "🔴", text: "x" }],
      leave: {},
      centers: {
        工程: { label: "工程部", members: ["A"], parent: "產品中心", validCodes: {} },
      },
      parentCenters: {
        產品中心: { label: "產品中心", children: ["工程"] },
      },
    };
    const out = expandOrgStructure(data);
    expect(out.rawData).toEqual(data.rawData);
    expect(out.issues).toEqual(data.issues);
    expect(out.leave).toEqual(data.leave);
  });
});
