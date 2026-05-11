import { describe, it, expect } from "vitest";
import { computeUncategorizedStats } from "../../src/utils/uncategorized";

const I = (code: string | null, hours: number, task = "x") => ({ code, task, hours });
const E = (items: any[]) => ({ total: 0, meeting: 0, dev: 0, status: "reported" as const, items });

describe("computeUncategorizedStats", () => {
  it("returns rate=null when no entry has items field (legacy data)", () => {
    const raw = { "5/1": { Joyce: { total: 8, meeting: 0, dev: 8, status: "reported" as const } } };
    const r = computeUncategorizedStats(raw);
    expect(r.rate).toBeNull();
  });

  it("computes 0% when all items have a code", () => {
    const raw = { "5/8": { Joyce: E([I("KEYPO", 3), I("BDE", 2)]) } };
    const r = computeUncategorizedStats(raw);
    expect(r.rate).toBe(0);
    expect(r.categorizedHours).toBe(5);
    expect(r.uncategorizedHours).toBe(0);
  });

  it("computes 100% when all items have null code", () => {
    const raw = { "5/8": { Joyce: E([I(null, 3), I(null, 5)]) } };
    const r = computeUncategorizedStats(raw);
    expect(r.rate).toBe(100);
  });

  it("computes mixed rate accurately", () => {
    const raw = {
      "5/8": {
        Joyce: E([I("KEYPO", 5), I(null, 1)]),
        Ivy: E([I("BDE", 3), I(null, 1)]),
      },
    };
    const r = computeUncategorizedStats(raw);
    // 2 uncategorized / 10 total = 20%
    expect(r.rate).toBe(20);
    expect(r.uncategorizedHours).toBe(2);
    expect(r.categorizedHours).toBe(8);
  });

  it("respects dates filter", () => {
    const raw = {
      "5/8": { Joyce: E([I(null, 5)]) },
      "5/9": { Joyce: E([I("KEYPO", 5)]) },
    };
    expect(computeUncategorizedStats(raw, { dates: ["5/8"] }).rate).toBe(100);
    expect(computeUncategorizedStats(raw, { dates: ["5/9"] }).rate).toBe(0);
  });

  it("respects members filter", () => {
    const raw = {
      "5/8": {
        Joyce: E([I(null, 4)]),
        Ivy: E([I("KEYPO", 4)]),
      },
    };
    expect(computeUncategorizedStats(raw, { members: ["Joyce"] }).rate).toBe(100);
    expect(computeUncategorizedStats(raw, { members: ["Ivy"] }).rate).toBe(0);
  });

  it("rounds rate to one decimal place", () => {
    const raw = {
      "5/8": {
        Joyce: E([I(null, 1), I("KEYPO", 2)]), // 1/3 = 33.33...%
      },
    };
    expect(computeUncategorizedStats(raw).rate).toBe(33.3);
  });

  it("ignores entries with missing items even when other entries have items", () => {
    const raw = {
      "5/8": {
        Joyce: E([I("KEYPO", 5)]),
        Old: { total: 8, meeting: 0, dev: 8, status: "reported" as const }, // no items
      },
    };
    const r = computeUncategorizedStats(raw);
    expect(r.totalHoursWithItems).toBe(5);
    expect(r.rate).toBe(0);
  });
});
