import { describe, it, expect } from 'vitest';
import { mergeDailyData } from '../scripts/merge-daily-data.js';

describe('mergeDailyData', () => {
  const existing = {
    rawData: {
      '3/5': {
        Joyce: { total: 10, meeting: 0, dev: 10 },
        Ivy: { total: 4, meeting: 0, dev: 4 },
      },
    },
    issues: [{ member: 'Joyce', severity: '🟡', text: '超時 10hr' }],
    leave: { Jason: [{ start: '3/5', end: '3/11' }] },
  };

  const parsed = {
    dateEntries: {
      '3/6': {
        threadDate: '3/7',
        contentDate: '3/6',
        entry: {
          Joyce: { total: 8, meeting: 2, dev: 6 },
          Ivy: { total: 7, meeting: 0, dev: 7 },
        },
        alreadyExists: false,
        reportedCount: 2,
        totalMembers: 2,
      },
    },
    leaveMap: {
      Jason: [{ start: '3/5', end: '3/11' }],
      Aaron: [{ start: '3/13', end: '3/13' }],
    },
    issues: [
      { member: 'Joyce', severity: '🟢', text: '穩定 8hr' },
      { member: 'Ivy', severity: '🟢', text: '穩定 7hr' },
    ],
    warnings: [],
  };

  it('should merge new date entries into rawData', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.rawData['3/5']).toEqual(existing.rawData['3/5']);
    expect(result.rawData['3/6']).toEqual(parsed.dateEntries['3/6'].entry);
  });

  it('should skip dates that already exist', () => {
    const parsedWithExisting = {
      ...parsed,
      dateEntries: {
        ...parsed.dateEntries,
        '3/5': {
          ...parsed.dateEntries['3/6'],
          alreadyExists: true,
          entry: { Joyce: { total: 99, meeting: 0, dev: 99 } },
        },
      },
    };
    const result = mergeDailyData(existing, parsedWithExisting);
    expect(result.rawData['3/5'].Joyce.total).toBe(10);
  });

  it('should replace issues with parsed issues', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.issues).toEqual(parsed.issues);
  });

  it('should replace leave with parsed leaveMap', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.leave).toEqual(parsed.leaveMap);
  });
});
