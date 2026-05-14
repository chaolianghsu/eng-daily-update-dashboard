// tests/unit/hooks/useCXOMetrics.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useCenterROI,
  useSpecOwnership,
  useWeeklyHealth,
  useTopRisks,
  useCapacityHeatmap,
  resolvePeriod,
} from "../../../src/hooks/useCXOMetrics";

const multiCenter = {
  工程: { label: "工程部", members: ["A", "B"] },
  產品: { label: "產品中心", members: ["P1"] },
  技發: { label: "技發中心", members: ["T1"] },
};

const singleCenter = {
  工程: { label: "工程部", members: ["A", "B"] },
};

const baseRawData = {
  "3/9": { A: { total: 8, meeting: 1, dev: 7 }, B: { total: 6, meeting: 2, dev: 4 } },
  "3/10": { A: { total: 8, meeting: 0, dev: 8 }, B: { total: 7, meeting: 1, dev: 6 } },
  "3/11": { A: { total: 9, meeting: 1, dev: 8 }, B: { total: 5, meeting: 0, dev: 5 } },
  "3/12": { A: { total: 7, meeting: 1, dev: 6 }, B: { total: 6, meeting: 1, dev: 5 } },
  "3/13": { A: { total: 8, meeting: 2, dev: 6 }, B: { total: 7, meeting: 1, dev: 6 } },
};

const baseCommits = {
  commits: {
    "3/13": {
      A: { count: 5, projects: ["p1"], items: [
        { title: "fix: x", sha: "a1", project: "p1", url: "http://e/a1", source: "gitlab" as const },
      ] },
      B: { count: 2, projects: ["p1"], items: [] },
    },
  },
  analysis: {
    "3/13": {
      A: { status: "✅", commitCount: 5, hours: 8 },
      B: { status: "⚠️", commitCount: 2, hours: 7 },
    },
  },
  projectRisks: [{ project: "solo-repo", soloContributor: "A", severity: "🟡" }],
};

describe("resolvePeriod", () => {
  it("uses provided period dates", () => {
    const p = resolvePeriod({ dates: ["3/9", "3/10"] }, ["3/9", "3/10", "3/11"]);
    expect(p.dates).toEqual(["3/9", "3/10"]);
  });
  it("falls back to all dates when no period given", () => {
    const p = resolvePeriod(undefined, ["3/9", "3/10"]);
    expect(p.dates).toEqual(["3/9", "3/10"]);
  });
});

describe("useCenterROI", () => {
  it("returns empty array when rawData null", () => {
    const { result } = renderHook(() =>
      useCenterROI(null, null, { dates: ["3/9"] }, null)
    );
    expect(result.current).toEqual([]);
  });

  it("sums dev hours per center and counts commits", () => {
    const { result } = renderHook(() =>
      useCenterROI(baseRawData, baseCommits as any, { dates: ["3/13"] }, singleCenter)
    );
    expect(result.current).toHaveLength(1);
    const eng = result.current[0];
    expect(eng.center).toBe("工程");
    expect(eng.devHours).toBe(12); // 6 + 6
    expect(eng.commits).toBe(7); // 5 + 2
    expect(eng.members).toEqual(["A", "B"]);
  });

  it("computes peopleMonth using workdays in period", () => {
    const { result } = renderHook(() =>
      useCenterROI(baseRawData, null, { dates: ["3/9", "3/10", "3/11", "3/12", "3/13"] }, singleCenter)
    );
    // devHours: A=35, B=26 → total 61. peopleMonth = 61 / 8 / 5 = 1.525
    expect(result.current[0].devHours).toBe(61);
    expect(result.current[0].peopleMonth).toBeCloseTo(1.525, 2);
  });

  it("treats unknown center as placeholder when no members", () => {
    const { result } = renderHook(() =>
      useCenterROI(baseRawData, null, { dates: ["3/9"] }, multiCenter)
    );
    expect(result.current).toHaveLength(3);
    const prod = result.current.find(r => r.center === "產品");
    expect(prod?.placeholder).toBeFalsy(); // 產品 has P1 but no data → still real, but devHours=0
    expect(prod?.devHours).toBe(0);
  });

  it("marks placeholder when center has no members in mapping", () => {
    const cfg = {
      工程: { label: "工程部", members: ["A", "B"] },
      產品: { label: "產品中心", members: [] },
    };
    const { result } = renderHook(() =>
      useCenterROI(baseRawData, null, { dates: ["3/9"] }, cfg)
    );
    expect(result.current.find(r => r.center === "產品")?.placeholder).toBe(true);
  });

  it("defaults to single 工程 center when centers config missing", () => {
    const { result } = renderHook(() =>
      useCenterROI(baseRawData, null, { dates: ["3/9"] }, null)
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].center).toBe("工程");
    expect(result.current[0].members.sort()).toEqual(["A", "B"]);
  });

  it("counts reported items from rawData items[]", () => {
    const raw = {
      "3/9": { A: { total: 8, meeting: 0, dev: 8, items: [{ task: "t1" }, { task: "t2" }] } },
    };
    const { result } = renderHook(() =>
      useCenterROI(raw, null, { dates: ["3/9"] }, singleCenter)
    );
    expect(result.current[0].items).toBe(2);
  });
});

describe("useSpecOwnership", () => {
  const planData = {
    analysisDate: "2026-03-13",
    period: "3/9-3/13",
    planSpecs: [
      { date: "3/13", member: "A", commit: { title: "spec: x", sha: "s1", project: "p1", url: "u1", source: "gitlab" as const }, files: ["docs/x.md"] },
      { date: "3/12", member: "P1", commit: { title: "plan: y", sha: "s2", project: "p2", url: "u2", source: "gitlab" as const }, files: ["plans/y.md"] },
    ],
    correlations: [
      { date: "3/13", member: "A", status: "matched" as const, specCommits: 1, dailyUpdateMention: true, matchedTasks: ["x"], unmatchedSpecs: [], reasoning: "ok" },
    ],
    summary: { totalSpecCommits: 2, totalCorrelations: 1, membersWithSpecs: 2, matched: 1, unmatched: 0, partial: 0 },
  };

  it("returns empty array when planAnalysis null", () => {
    const { result } = renderHook(() => useSpecOwnership(null, multiCenter));
    expect(result.current).toEqual([]);
  });

  it("returns spec ownership rows with center", () => {
    const { result } = renderHook(() => useSpecOwnership(planData, multiCenter));
    expect(result.current).toHaveLength(2);
    const a = result.current.find(r => r.member === "A");
    expect(a?.center).toBe("工程");
    const p1 = result.current.find(r => r.member === "P1");
    expect(p1?.center).toBe("產品");
  });

  it("assigns status from correlation when available", () => {
    const { result } = renderHook(() => useSpecOwnership(planData, multiCenter));
    const matched = result.current.find(r => r.member === "A" && r.date === "3/13");
    expect(matched?.status).toBe("matched");
  });

  it("limits to most recent 8", () => {
    const many = {
      ...planData,
      planSpecs: Array.from({ length: 12 }, (_, i) => ({
        date: `3/${i + 1}`,
        member: "A",
        commit: { title: `spec ${i}`, sha: `s${i}`, project: "p", url: "u", source: "gitlab" as const },
        files: [`docs/${i}.md`],
      })),
    };
    const { result } = renderHook(() => useSpecOwnership(many, multiCenter, 8));
    expect(result.current).toHaveLength(8);
  });
});

describe("useWeeklyHealth", () => {
  it("returns zero metrics for empty period", () => {
    const { result } = renderHook(() => useWeeklyHealth(null, null, null, { dates: [] }, []));
    expect(result.current.reportingRate).toBe(0);
  });

  it("calculates reporting rate", () => {
    const raw = {
      "3/13": { A: { total: 8, meeting: 1, dev: 7 }, B: { total: null, meeting: null, dev: null } },
    };
    const { result } = renderHook(() =>
      useWeeklyHealth(raw, null, null, { dates: ["3/13"] }, ["A", "B"])
    );
    // 1 of 2 reported → 50%
    expect(result.current.reportingRate).toBe(50);
  });

  it("aggregates consistency counts", () => {
    const { result } = renderHook(() =>
      useWeeklyHealth(baseRawData, baseCommits as any, null, { dates: ["3/13"] }, ["A", "B"])
    );
    expect(result.current.consistency).toEqual({ ok: 1, warn: 1, crit: 0 });
  });

  it("counts task warnings by severity within period", () => {
    const task = {
      analysisDate: "2026-03-13",
      period: "3/13",
      warnings: [
        { date: "3/13", member: "A", severity: "🔴", type: "low_output", task: "t", commits: "c", reasoning: "r" },
        { date: "3/13", member: "B", severity: "🟡", type: "outlier", task: "t", commits: "c", reasoning: "r" },
        { date: "3/8", member: "A", severity: "🔴", type: "x", task: "t", commits: "c", reasoning: "r" },
      ],
      summary: { totalWarnings: 3, critical: 2, warning: 1, caution: 0 },
    };
    const { result } = renderHook(() =>
      useWeeklyHealth(baseRawData, null, task, { dates: ["3/13"] }, ["A", "B"])
    );
    expect(result.current.warnings).toEqual({ crit: 1, warn: 1 });
  });
});

describe("useTopRisks", () => {
  it("returns empty array when no inputs", () => {
    const { result } = renderHook(() => useTopRisks([], null, null, null, ["A"], { dates: [] }));
    expect(result.current).toEqual([]);
  });

  it("merges issues, task warnings, and orphan commits", () => {
    const issues = [
      { member: "A", severity: "🔴", text: "超時 12hr" },
      { member: "C", severity: "🟢", text: "穩定" },
    ];
    const task = {
      analysisDate: "x", period: "x",
      warnings: [
        { date: "3/13", member: "B", severity: "🟡", type: "outlier", task: "t", commits: "c", reasoning: "r" },
      ],
      summary: { totalWarnings: 1, critical: 0, warning: 1, caution: 0 },
    };
    const { result } = renderHook(() =>
      useTopRisks(issues, task, baseCommits as any, baseRawData, ["A", "B", "C"], { dates: ["3/13"] })
    );
    expect(result.current.length).toBeGreaterThan(0);
    // 🔴 should rank above 🟡
    expect(result.current[0].severity).toBe("🔴");
  });

  it("caps at 5 rows", () => {
    const manyIssues = Array.from({ length: 10 }, (_, i) => ({
      member: `M${i}`,
      severity: "🔴",
      text: `issue ${i}`,
    }));
    const { result } = renderHook(() =>
      useTopRisks(manyIssues, null, null, null, [], { dates: [] })
    );
    expect(result.current).toHaveLength(5);
  });

  it("detects member with commits but no daily report (orphan)", () => {
    // Member has commits ≥ threshold but no daily update
    const commits = {
      commits: {
        "3/13": {
          A: { count: 7, projects: ["p"], items: [] },
        },
      },
      analysis: {
        "3/13": {
          A: { status: "🔴", commitCount: 7, hours: null },
        },
      },
      projectRisks: [],
    };
    const raw = { "3/13": { A: { total: null, meeting: null, dev: null } } };
    const { result } = renderHook(() =>
      useTopRisks([], null, commits as any, raw, ["A"], { dates: ["3/13"] }, 5)
    );
    const orphan = result.current.find(r => r.kind === "orphan_commits");
    expect(orphan).toBeDefined();
    expect(orphan?.member).toBe("A");
  });

  it("includes single-contributor project risks", () => {
    const { result } = renderHook(() =>
      useTopRisks([], null, baseCommits as any, baseRawData, ["A", "B"], { dates: ["3/13"] })
    );
    const solo = result.current.find(r => r.kind === "solo_project");
    expect(solo).toBeDefined();
  });
});

describe("useCapacityHeatmap", () => {
  it("returns empty when rawData null", () => {
    const { result } = renderHook(() => useCapacityHeatmap(null, [], 4, singleCenter));
    expect(result.current.centers).toEqual([]);
  });

  it("buckets last 4 weeks of dev hours per member", () => {
    // Build dates spanning 4 weeks
    const dates = [
      "3/9", "3/10", "3/11", "3/12", "3/13", // W1
      "3/16", "3/17", "3/18", "3/19", "3/20", // W2
    ];
    const raw: any = {};
    dates.forEach(d => {
      raw[d] = { A: { total: 8, meeting: 0, dev: 8 }, B: { total: 6, meeting: 0, dev: 6 } };
    });
    const { result } = renderHook(() =>
      useCapacityHeatmap(raw, dates, 4, singleCenter)
    );
    expect(result.current.centers).toHaveLength(1);
    const eng = result.current.centers[0];
    expect(eng.members).toHaveLength(2);
    const a = eng.members.find(m => m.name === "A");
    expect(a?.weeks).toHaveLength(4);
    // most recent two weeks should have hours; older two are zero
    const nonZero = a!.weeks.filter(h => h > 0);
    expect(nonZero.length).toBeGreaterThan(0);
    // Each populated week sums to 40 (8 × 5 days)
    expect(nonZero.every(h => h === 40)).toBe(true);
  });

  it("groups members by center", () => {
    const cfg = {
      工程: { label: "工程部", members: ["A"] },
      產品: { label: "產品中心", members: ["B"] },
    };
    const raw = { "3/13": { A: { total: 8, meeting: 0, dev: 8 }, B: { total: 8, meeting: 0, dev: 8 } } };
    const { result } = renderHook(() =>
      useCapacityHeatmap(raw, ["3/13"], 4, cfg)
    );
    expect(result.current.centers).toHaveLength(2);
    expect(result.current.centers.find(c => c.center === "工程")?.members[0].name).toBe("A");
    expect(result.current.centers.find(c => c.center === "產品")?.members[0].name).toBe("B");
  });
});
