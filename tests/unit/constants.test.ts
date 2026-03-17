// tests/unit/constants.test.ts
import { describe, it, expect } from "vitest";
import { COLORS, SEVERITY_COLORS, THRESHOLDS, WEEK_DAYS, MEMBER_PALETTE, PROJECT_PALETTE } from "../../src/constants";

describe("SEVERITY_COLORS", () => {
  it("maps all four severity emojis", () => {
    expect(SEVERITY_COLORS["🔴"]).toBeDefined();
    expect(SEVERITY_COLORS["🟡"]).toBeDefined();
    expect(SEVERITY_COLORS["🟠"]).toBeDefined();
    expect(SEVERITY_COLORS["🟢"]).toBeDefined();
  });

  it("each has sc and bg properties", () => {
    for (const [, value] of Object.entries(SEVERITY_COLORS)) {
      expect(value).toHaveProperty("sc");
      expect(value).toHaveProperty("bg");
    }
  });

  it("red severity uses COLORS.red", () => {
    expect(SEVERITY_COLORS["🔴"].sc).toBe(COLORS.red);
    expect(SEVERITY_COLORS["🔴"].bg).toBe(COLORS.redDim);
  });
});

describe("THRESHOLDS", () => {
  it("has correct ordering", () => {
    expect(THRESHOLDS.low).toBeLessThan(THRESHOLDS.ok);
    expect(THRESHOLDS.ok).toBeLessThan(THRESHOLDS.target);
    expect(THRESHOLDS.target).toBeLessThan(THRESHOLDS.high);
    expect(THRESHOLDS.high).toBeLessThan(THRESHOLDS.overtime);
  });
});

describe("WEEK_DAYS", () => {
  it("has 7 entries starting with 日", () => {
    expect(WEEK_DAYS).toHaveLength(7);
    expect(WEEK_DAYS[0]).toBe("日");
    expect(WEEK_DAYS[1]).toBe("一");
  });
});

describe("Palettes", () => {
  it("MEMBER_PALETTE has 16 colors", () => {
    expect(MEMBER_PALETTE).toHaveLength(16);
  });

  it("PROJECT_PALETTE has 10 colors", () => {
    expect(PROJECT_PALETTE).toHaveLength(10);
  });
});
