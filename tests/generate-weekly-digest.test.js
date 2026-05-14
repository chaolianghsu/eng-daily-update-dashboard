import { describe, it, expect } from 'vitest';
import {
  parseWeekArg,
  computeDefaultWeek,
  expandWeekDates,
  aggregateMetrics,
  findConsecutiveMissing,
  buildPrompt,
  formatChatMessage,
} from '../scripts/generate-weekly-digest.js';

// --- Fixtures ---

function singleCenterRawData() {
  return {
    centers: {
      工程: {
        label: '工程部',
        members: ['Alice', 'Bob', 'Carol'],
      },
    },
    rawData: {
      '5/5': {
        Alice: { total: 8, meeting: 1, dev: 7 },
        Bob: { total: 7, meeting: 0, dev: 7 },
        Carol: { total: null, meeting: null, dev: null },
      },
      '5/6': {
        Alice: { total: 8, meeting: 2, dev: 6 },
        Bob: { total: null, meeting: null, dev: null },
        Carol: { total: null, meeting: null, dev: null },
      },
      '5/7': {
        Alice: { total: 6, meeting: 0, dev: 6 },
        Bob: { total: null, meeting: null, dev: null },
        Carol: { total: null, meeting: null, dev: null },
      },
      '5/8': {
        Alice: { total: 8, meeting: 1, dev: 7 },
        Bob: { total: null, meeting: null, dev: null },
        Carol: { total: null, meeting: null, dev: null },
      },
      '5/9': {
        Alice: { total: 8, meeting: 0, dev: 8 },
        Bob: { total: null, meeting: null, dev: null },
        Carol: { total: null, meeting: null, dev: null },
      },
    },
    leave: {},
  };
}

function multiCenterRawData() {
  return {
    centers: {
      工程: { label: '工程部', members: ['Alice', 'Bob'] },
      產品: { label: '產品部', members: ['Pete'] },
      技發: { label: '技發部', members: ['Tara'] },
    },
    rawData: {
      '5/5': {
        Alice: { total: 8, meeting: 1, dev: 7 },
        Bob: { total: 7, meeting: 0, dev: 7 },
        Pete: { total: 6, meeting: 2, dev: 4 },
        Tara: { total: null, meeting: null, dev: null },
      },
      '5/6': {
        Alice: { total: 8, meeting: 1, dev: 7 },
        Bob: { total: 6, meeting: 0, dev: 6 },
        Pete: { total: 5, meeting: 1, dev: 4 },
        Tara: { total: 8, meeting: 0, dev: 8 },
      },
    },
    leave: {},
  };
}

function fixtureCommits() {
  return {
    commits: {
      '5/5': {
        Alice: { count: 3, projects: ['app'], items: [] },
        Bob: { count: 2, projects: ['app'], items: [] },
      },
      '5/6': {
        Alice: { count: 4, projects: ['app'], items: [] },
      },
    },
    analysis: {
      '5/5': {
        Alice: { status: '✅', commitCount: 3, hours: 8 },
        Bob: { status: '✅', commitCount: 2, hours: 7 },
      },
      '5/6': {
        Alice: { status: '✅', commitCount: 4, hours: 8 },
        Bob: { status: '⚠️', commitCount: 0, hours: 6 },
      },
    },
  };
}

// --- Tests ---

describe('parseWeekArg', () => {
  it('parses M/D-M/D format', () => {
    const r = parseWeekArg('5/5-5/9');
    expect(r.start).toBe('5/5');
    expect(r.end).toBe('5/9');
  });

  it('returns null for invalid format', () => {
    expect(parseWeekArg('foo')).toBeNull();
    expect(parseWeekArg('5/5')).toBeNull();
    expect(parseWeekArg('')).toBeNull();
  });
});

describe('computeDefaultWeek', () => {
  it('returns last full Mon-Fri given a date in current week', () => {
    // 2026-05-14 is a Thursday → last full week is Mon 5/5 – Fri 5/9
    const r = computeDefaultWeek(new Date('2026-05-14T12:00:00'));
    expect(r.start).toBe('5/4');
    expect(r.end).toBe('5/8');
  });

  it('handles Monday correctly (previous Mon-Fri)', () => {
    // 2026-05-11 is a Monday → the most recently completed Mon-Fri block is 5/4-5/8
    const r = computeDefaultWeek(new Date('2026-05-11T12:00:00'));
    expect(r.start).toBe('5/4');
    expect(r.end).toBe('5/8');
  });

  it('handles Sunday correctly', () => {
    // 2026-05-10 is a Sunday → previous full week is 5/4-5/8
    const r = computeDefaultWeek(new Date('2026-05-10T12:00:00'));
    expect(r.start).toBe('5/4');
    expect(r.end).toBe('5/8');
  });
});

describe('expandWeekDates', () => {
  it('returns list of M/D dates in range, inclusive', () => {
    const dates = expandWeekDates('5/5', '5/9');
    expect(dates).toEqual(['5/5', '5/6', '5/7', '5/8', '5/9']);
  });

  it('handles single day', () => {
    expect(expandWeekDates('5/5', '5/5')).toEqual(['5/5']);
  });

  it('handles month crossing', () => {
    const dates = expandWeekDates('4/29', '5/2');
    expect(dates).toEqual(['4/29', '4/30', '5/1', '5/2']);
  });
});

describe('aggregateMetrics (single center)', () => {
  it('computes per-center totals and reporting rate', () => {
    const data = singleCenterRawData();
    const commits = fixtureCommits();
    const taskAnalysis = { warnings: [] };
    const planAnalysis = { summary: { matched: 0, unmatched: 0, partial: 0 } };
    const dates = ['5/5', '5/6', '5/7', '5/8', '5/9'];

    const result = aggregateMetrics({
      rawData: data.rawData,
      centers: data.centers,
      leave: data.leave,
      commits: commits.commits,
      analysis: commits.analysis,
      taskAnalysis,
      planAnalysis,
      weekDates: dates,
    });

    expect(result.centers).toHaveLength(1);
    const eng = result.centers[0];
    expect(eng.key).toBe('工程');
    expect(eng.label).toBe('工程部');
    expect(eng.memberCount).toBe(3);
    expect(eng.workdays).toBe(5);
    // Alice reported 5 days, Bob reported 1, Carol 0 → 6/15 = 40%
    expect(eng.reportedEntries).toBe(6);
    expect(eng.totalEntries).toBe(15);
    expect(eng.reportingRate).toBeCloseTo(6 / 15, 2);
    // Total dev hours: Alice 7+6+6+7+8=34, Bob 7 → 41
    expect(eng.totalDevHours).toBe(34 + 7);
    // Total meeting: Alice 1+2+0+1+0=4, Bob 0 → 4
    expect(eng.totalMeetingHours).toBe(4);
  });

  it('aggregates commits and consistency distribution', () => {
    const data = singleCenterRawData();
    const commits = fixtureCommits();
    const dates = ['5/5', '5/6', '5/7', '5/8', '5/9'];

    const result = aggregateMetrics({
      rawData: data.rawData,
      centers: data.centers,
      leave: data.leave,
      commits: commits.commits,
      analysis: commits.analysis,
      taskAnalysis: { warnings: [] },
      planAnalysis: { summary: {} },
      weekDates: dates,
    });

    const eng = result.centers[0];
    expect(eng.totalCommits).toBe(3 + 2 + 4); // 9
    expect(eng.consistency['✅']).toBe(3);
    expect(eng.consistency['⚠️']).toBe(1);
    expect(eng.consistency['🔴']).toBe(0);
  });

  it('attaches top warnings limited to 5', () => {
    const data = singleCenterRawData();
    const commits = fixtureCommits();
    const taskAnalysis = {
      warnings: [
        { date: '5/5', member: 'Alice', severity: '🔴', task: 't1', reasoning: 'r1' },
        { date: '5/6', member: 'Alice', severity: '🟡', task: 't2', reasoning: 'r2' },
        { date: '5/6', member: 'Bob', severity: '🟡', task: 't3', reasoning: 'r3' },
        { date: '5/7', member: 'Alice', severity: '🟠', task: 't4', reasoning: 'r4' },
        { date: '5/8', member: 'Alice', severity: '🔴', task: 't5', reasoning: 'r5' },
        { date: '5/9', member: 'Alice', severity: '🟡', task: 't6', reasoning: 'r6' },
      ],
    };
    const dates = ['5/5', '5/6', '5/7', '5/8', '5/9'];

    const result = aggregateMetrics({
      rawData: data.rawData,
      centers: data.centers,
      leave: data.leave,
      commits: commits.commits,
      analysis: commits.analysis,
      taskAnalysis,
      planAnalysis: { summary: {} },
      weekDates: dates,
    });

    const eng = result.centers[0];
    expect(eng.topWarnings).toHaveLength(5);
    // Critical (🔴) should come first
    expect(eng.topWarnings[0].severity).toBe('🔴');
  });

  it('counts plan analysis spec activity', () => {
    const data = singleCenterRawData();
    const commits = fixtureCommits();
    const planAnalysis = {
      summary: { matched: 3, unmatched: 1, partial: 2, totalSpecCommits: 6 },
    };
    const dates = ['5/5', '5/6', '5/7', '5/8', '5/9'];

    const result = aggregateMetrics({
      rawData: data.rawData,
      centers: data.centers,
      leave: data.leave,
      commits: commits.commits,
      analysis: commits.analysis,
      taskAnalysis: { warnings: [] },
      planAnalysis,
      weekDates: dates,
    });

    expect(result.specActivity.matched).toBe(3);
    expect(result.specActivity.unmatched).toBe(1);
    expect(result.specActivity.partial).toBe(2);
  });
});

describe('aggregateMetrics (multi-center)', () => {
  it('produces one entry per center', () => {
    const data = multiCenterRawData();
    const dates = ['5/5', '5/6'];

    const result = aggregateMetrics({
      rawData: data.rawData,
      centers: data.centers,
      leave: data.leave,
      commits: {},
      analysis: {},
      taskAnalysis: { warnings: [] },
      planAnalysis: { summary: {} },
      weekDates: dates,
    });

    expect(result.centers).toHaveLength(3);
    const keys = result.centers.map(c => c.key).sort();
    expect(keys).toEqual(['工程', '技發', '產品']);
  });

  it('assigns members to correct centers and computes totals separately', () => {
    const data = multiCenterRawData();
    const dates = ['5/5', '5/6'];

    const result = aggregateMetrics({
      rawData: data.rawData,
      centers: data.centers,
      leave: data.leave,
      commits: {},
      analysis: {},
      taskAnalysis: { warnings: [] },
      planAnalysis: { summary: {} },
      weekDates: dates,
    });

    const eng = result.centers.find(c => c.key === '工程');
    const prod = result.centers.find(c => c.key === '產品');
    const tech = result.centers.find(c => c.key === '技發');

    expect(eng.memberCount).toBe(2);
    expect(prod.memberCount).toBe(1);
    expect(tech.memberCount).toBe(1);

    // Eng: Alice 7+7=14, Bob 7+6=13 → dev=27
    expect(eng.totalDevHours).toBe(27);
    // Pete: 4+4=8
    expect(prod.totalDevHours).toBe(8);
    // Tara: only 5/6 → 8
    expect(tech.totalDevHours).toBe(8);
  });
});

describe('aggregateMetrics (fallback when no centers config)', () => {
  it('falls back to single 工程 center using all rawData members', () => {
    const dates = ['5/5', '5/6'];
    const rawData = {
      '5/5': {
        Alice: { total: 8, meeting: 1, dev: 7 },
        Bob: { total: 8, meeting: 0, dev: 8 },
      },
      '5/6': {
        Alice: { total: 8, meeting: 1, dev: 7 },
        Bob: { total: 7, meeting: 0, dev: 7 },
      },
    };

    const result = aggregateMetrics({
      rawData,
      centers: null,
      leave: {},
      commits: {},
      analysis: {},
      taskAnalysis: { warnings: [] },
      planAnalysis: { summary: {} },
      weekDates: dates,
    });

    expect(result.centers).toHaveLength(1);
    expect(result.centers[0].key).toBe('工程');
    expect(result.centers[0].memberCount).toBe(2);
  });
});

describe('findConsecutiveMissing', () => {
  it('flags members missing ≥3 consecutive days', () => {
    const rawData = {
      '5/5': { Alice: { total: 8 }, Bob: { total: null } },
      '5/6': { Alice: { total: 8 }, Bob: { total: null } },
      '5/7': { Alice: { total: 8 }, Bob: { total: null } },
      '5/8': { Alice: { total: 8 }, Bob: { total: 8 } },
      '5/9': { Alice: { total: 8 }, Bob: { total: 8 } },
    };
    const members = ['Alice', 'Bob'];
    const dates = ['5/5', '5/6', '5/7', '5/8', '5/9'];

    const r = findConsecutiveMissing(rawData, members, dates, {});
    expect(r).toEqual([{ member: 'Bob', missingDays: 3 }]);
  });

  it('does not flag members on leave during missing days', () => {
    const rawData = {
      '5/5': { Bob: { total: null } },
      '5/6': { Bob: { total: null } },
      '5/7': { Bob: { total: null } },
      '5/8': { Bob: { total: 8 } },
    };
    const leave = { Bob: [{ start: '5/5', end: '5/7' }] };
    const r = findConsecutiveMissing(rawData, ['Bob'], ['5/5', '5/6', '5/7', '5/8'], leave);
    expect(r).toEqual([]);
  });

  it('does not flag members missing fewer than 3 days', () => {
    const rawData = {
      '5/5': { Bob: { total: null } },
      '5/6': { Bob: { total: null } },
      '5/7': { Bob: { total: 8 } },
    };
    const r = findConsecutiveMissing(rawData, ['Bob'], ['5/5', '5/6', '5/7'], {});
    expect(r).toEqual([]);
  });
});

describe('buildPrompt', () => {
  it('produces a non-empty prompt mentioning all centers', () => {
    const metrics = {
      weekRange: '5/5-5/9',
      centers: [
        {
          key: '工程',
          label: '工程部',
          memberCount: 3,
          workdays: 5,
          reportedEntries: 6,
          totalEntries: 15,
          reportingRate: 0.4,
          totalDevHours: 41,
          totalMeetingHours: 4,
          avgDevHoursPerMember: 41 / 3,
          totalCommits: 9,
          consistency: { '✅': 3, '⚠️': 1, '🔴': 0 },
          topWarnings: [],
          consecutiveMissing: [],
        },
      ],
      specActivity: { matched: 3, unmatched: 1, partial: 2 },
    };
    const prompt = buildPrompt(metrics);
    expect(prompt).toContain('5/5-5/9');
    expect(prompt).toContain('工程部');
    expect(prompt).toContain('highlights');
    expect(prompt).toContain('attention');
    expect(prompt).toContain('recommendations');
  });
});

describe('formatChatMessage', () => {
  it('formats digest JSON into Google Chat markdown', () => {
    const digest = {
      weekRange: '5/5-5/9',
      highlights: ['完成 A 模組', '完成 B 模組', '完成 C 模組'],
      attention: [
        { severity: '🔴', subject: 'Bob', detail: '連續 3 天未回報' },
        { severity: '🟡', subject: 'Alice', detail: '產出偏低' },
      ],
      recommendations: ['下週重點放在 X', '加強 code review'],
    };
    const md = formatChatMessage(digest);
    expect(md).toContain('5/5-5/9');
    expect(md).toContain('🎯 本週重點');
    expect(md).toContain('完成 A 模組');
    expect(md).toContain('⚠️ 需關注');
    expect(md).toContain('🔴 Bob');
    expect(md).toContain('💡 下週建議');
    expect(md).toContain('下週重點放在 X');
    expect(md).toContain('https://chaolianghsu.github.io/eng-daily-update-dashboard/');
  });

  it('handles empty highlights/attention/recommendations gracefully', () => {
    const digest = {
      weekRange: '5/5-5/9',
      highlights: [],
      attention: [],
      recommendations: [],
    };
    const md = formatChatMessage(digest);
    expect(md).toContain('5/5-5/9');
  });
});

describe('edge cases', () => {
  it('aggregateMetrics handles empty week (no data)', () => {
    const result = aggregateMetrics({
      rawData: {},
      centers: { 工程: { label: '工程部', members: ['Alice'] } },
      leave: {},
      commits: {},
      analysis: {},
      taskAnalysis: { warnings: [] },
      planAnalysis: { summary: {} },
      weekDates: ['5/5', '5/6'],
    });

    expect(result.centers).toHaveLength(1);
    const c = result.centers[0];
    expect(c.reportedEntries).toBe(0);
    expect(c.totalDevHours).toBe(0);
    expect(c.totalCommits).toBe(0);
  });
});
