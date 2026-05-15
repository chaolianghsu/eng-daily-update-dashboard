import { describe, it, expect } from "vitest";
import { aggregateByCode } from "../../src/utils/codeAggregation";

const I = (code: string | null, hours: number, task = "x") => ({ code, task, hours });
const E = (items: any[]) => ({ total: 0, meeting: 0, dev: 0, status: "reported" as const, items });

describe("aggregateByCode", () => {
  it("returns empty list when no entries have items", () => {
    const r = aggregateByCode({ "5/1": { Joyce: { total: 8, meeting: 0, dev: 8, status: "reported" as const } } }, undefined);
    expect(r).toEqual([]);
  });

  it("aggregates total hours per code across members and dates", () => {
    const raw = {
      "5/8": {
        Joyce: E([I("KEYPO", 3), I("BDE", 1)]),
        Ivy: E([I("KEYPO", 2)]),
      },
      "5/9": {
        Joyce: E([I("KEYPO", 4)]),
      },
    };
    const r = aggregateByCode(raw, undefined);
    const keypo = r.find((c) => c.code === "KEYPO")!;
    expect(keypo.totalHours).toBe(9);
    expect(keypo.memberCount).toBe(2);
    expect(keypo.members).toEqual(["Joyce", "Ivy"]); // sorted by hours desc (7 vs 2)
  });

  it("uses validCodes label and gitlabProjectPrefixes when available", () => {
    const raw = { "5/8": { Joyce: E([I("KEYPO", 3)]) } };
    const validCodes = {
      KEYPO: {
        label: "KEYPO 系列",
        category: "product" as const,
        gitlabProjectPrefixes: ["KEYPO/"],
      },
    };
    const [keypo] = aggregateByCode(raw, validCodes);
    expect(keypo.label).toBe("KEYPO 系列");
    expect(keypo.category).toBe("product");
    expect(keypo.gitlabProjectPrefixes).toEqual(["KEYPO/"]);
  });

  it("surfaces unknown codes (not in validCodes) with code as fallback label", () => {
    const raw = { "5/8": { Joyce: E([I("MYSTERY", 2)]) } };
    const [m] = aggregateByCode(raw, { KEYPO: { label: "KEYPO 系列" } });
    expect(m.code).toBe("MYSTERY");
    expect(m.label).toBe("MYSTERY");
  });

  it('groups uncategorized items under "(uncategorized)" key with 未分類 label', () => {
    const raw = { "5/8": { Joyce: E([I(null, 2)]) } };
    const [u] = aggregateByCode(raw, undefined);
    expect(u.code).toBe("(uncategorized)");
    expect(u.label).toBe("未分類");
  });

  it("excludes uncategorized when includeUncategorized=false", () => {
    const raw = {
      "5/8": { Joyce: E([I("KEYPO", 3), I(null, 1)]) },
    };
    const r = aggregateByCode(raw, undefined, { includeUncategorized: false });
    expect(r.map((c) => c.code)).toEqual(["KEYPO"]);
  });

  it("results are sorted by totalHours descending", () => {
    const raw = {
      "5/8": {
        Joyce: E([I("SMALL", 1), I("BIG", 10)]),
        Ivy: E([I("MEDIUM", 5)]),
      },
    };
    const r = aggregateByCode(raw, undefined);
    expect(r.map((c) => c.code)).toEqual(["BIG", "MEDIUM", "SMALL"]);
  });

  it("respects dates filter", () => {
    const raw = {
      "5/8": { Joyce: E([I("KEYPO", 3)]) },
      "5/9": { Joyce: E([I("BDE", 5)]) },
    };
    const r = aggregateByCode(raw, undefined, { dates: ["5/8"] });
    expect(r.map((c) => c.code)).toEqual(["KEYPO"]);
  });

  it("respects members filter", () => {
    const raw = {
      "5/8": {
        Joyce: E([I("KEYPO", 3)]),
        Ivy: E([I("BDE", 5)]),
      },
    };
    const r = aggregateByCode(raw, undefined, { members: ["Joyce"] });
    expect(r.map((c) => c.code)).toEqual(["KEYPO"]);
  });
});
