// tests/unit/utils.test.ts
import { describe, it, expect } from "vitest";
import { dateToNum, isOnLeave, getStatus, getBarColor, getTrendIcon, getWeekRange } from "../../src/utils";

describe("dateToNum", () => {
  it("converts M/D to sortable number", () => {
    expect(dateToNum("3/5")).toBe(305);
    expect(dateToNum("12/31")).toBe(1231);
  });

  it("sorts correctly", () => {
    expect(dateToNum("3/9")).toBeGreaterThan(dateToNum("3/5"));
    expect(dateToNum("4/1")).toBeGreaterThan(dateToNum("3/31"));
  });
});

describe("isOnLeave", () => {
  it("returns false for no leave ranges", () => {
    expect(isOnLeave("3/5")).toBe(false);
    expect(isOnLeave("3/5", undefined)).toBe(false);
  });

  it("returns true when date falls in range", () => {
    expect(isOnLeave("3/5", [{ start: "3/3", end: "3/7" }])).toBe(true);
  });

  it("returns false when date outside range", () => {
    expect(isOnLeave("3/8", [{ start: "3/3", end: "3/7" }])).toBe(false);
  });

  it("handles boundary dates", () => {
    expect(isOnLeave("3/3", [{ start: "3/3", end: "3/7" }])).toBe(true);
    expect(isOnLeave("3/7", [{ start: "3/3", end: "3/7" }])).toBe(true);
  });
});

describe("getStatus", () => {
  it("returns 休假 for null hours on leave", () => {
    const s = getStatus(null, true);
    expect(s.label).toBe("休假");
  });

  it("returns 未回報 for null hours not on leave", () => {
    expect(getStatus(null).label).toBe("未回報");
  });

  it("returns 超時 for hours > 10", () => {
    expect(getStatus(10.5).label).toBe("超時");
  });

  it("returns 合理 for hours in normal range", () => {
    expect(getStatus(7.5).label).toBe("合理");
  });

  it("returns 不足 for very low hours", () => {
    expect(getStatus(3).label).toBe("不足");
  });
});

describe("getBarColor", () => {
  it("returns textDim for null", () => {
    expect(getBarColor(null)).toContain("64748b");
  });

  it("returns yellow for high hours", () => {
    expect(getBarColor(9)).toContain("eab308");
  });
});

describe("getTrendIcon", () => {
  it("returns — for null values", () => {
    expect(getTrendIcon(null, 5)).toBe("—");
    expect(getTrendIcon(5, null)).toBe("—");
  });

  it("returns 📈 for large increase", () => {
    expect(getTrendIcon(5, 7)).toBe("📈");
  });

  it("returns ➡️ for no change", () => {
    expect(getTrendIcon(8, 8)).toBe("➡️");
  });
});

describe("getWeekRange", () => {
  it("returns monday-friday for a wednesday", () => {
    const wed = new Date(2026, 2, 11); // Wed Mar 11, 2026
    const { monday, friday } = getWeekRange(wed);
    expect(monday.getDay()).toBe(1); // Monday
    expect(friday.getDay()).toBe(5); // Friday
    expect(monday.getDate()).toBe(9);
    expect(friday.getDate()).toBe(13);
  });

  it("handles sunday correctly", () => {
    const sun = new Date(2026, 2, 15); // Sun Mar 15, 2026
    const { monday } = getWeekRange(sun);
    expect(monday.getDate()).toBe(9); // Previous Monday
  });
});
