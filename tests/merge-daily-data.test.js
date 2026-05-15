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
        rawReplies: [
          { member: 'Joyce', text: '3/6 進度：\n1. Task A (2H)\n2. Task B (6H)', createTime: '2026-03-07T01:30:00Z' },
          { member: 'Ivy', text: '3/6 進度：\n1. Task C (7H)', createTime: '2026-03-07T02:00:00Z' },
        ],
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

  it('should recalculate issues from merged data', () => {
    const result = mergeDailyData(existing, parsed);
    // Issues are recalculated from merged rawData, not passed through
    expect(result.issues).toBeInstanceOf(Array);
    expect(result.issues.length).toBeGreaterThan(0);
    // Joyce 8hr should be stable
    const joyceIssue = result.issues.find(i => i.member === 'Joyce');
    expect(joyceIssue.severity).toBe('🟢');
  });

  it('should replace leave with parsed leaveMap', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.leave).toEqual(parsed.leaveMap);
  });

  it('should collect dailyUpdates from rawReplies', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.dailyUpdates).toHaveLength(2);
    expect(result.dailyUpdates[0]).toEqual({
      date: '3/6',
      member: 'Joyce',
      createTime: '2026-03-07T01:30:00Z',
      text: '3/6 進度：\n1. Task A (2H)\n2. Task B (6H)',
      total: 8,
    });
    expect(result.dailyUpdates[1].member).toBe('Ivy');
    expect(result.dailyUpdates[1].total).toBe(7);
  });

  it('should return newDates and backfilled metadata', () => {
    const result = mergeDailyData(existing, parsed);
    expect(result.newDates).toEqual(['3/6']);
    expect(result.backfilled).toEqual([]);
  });

  it('should backfill null entries in existing dates', () => {
    const existingWithNull = {
      rawData: {
        '3/6': {
          Joyce: { total: 8, meeting: 2, dev: 6 },
          Ivy: { total: null, meeting: null, dev: null },
        },
      },
      issues: [],
      leave: {},
    };
    const parsedBackfill = {
      dateEntries: {
        '3/6': {
          threadDate: '3/7',
          contentDate: '3/6',
          entry: {
            Joyce: { total: 8, meeting: 2, dev: 6 },
            Ivy: { total: 7, meeting: 0, dev: 7 },
          },
          alreadyExists: true,
          reportedCount: 2,
          totalMembers: 2,
        },
      },
      leaveMap: {},
      issues: [],
    };
    const result = mergeDailyData(existingWithNull, parsedBackfill);
    expect(result.rawData['3/6'].Ivy.total).toBe(7);
    expect(result.newDates).toEqual([]);
    expect(result.backfilled).toEqual([
      { date: '3/6', member: 'Ivy', total: 7, meeting: 0, dev: 7 },
    ]);
  });

  it('should not overwrite existing non-null entries', () => {
    const existingWithData = {
      rawData: {
        '3/6': {
          Joyce: { total: 8, meeting: 2, dev: 6 },
        },
      },
      issues: [],
      leave: {},
    };
    const parsedDifferent = {
      dateEntries: {
        '3/6': {
          entry: { Joyce: { total: 99, meeting: 0, dev: 99 } },
          alreadyExists: true,
        },
      },
      leaveMap: {},
    };
    const result = mergeDailyData(existingWithData, parsedDifferent);
    expect(result.rawData['3/6'].Joyce.total).toBe(8);
    expect(result.backfilled).toEqual([]);
  });

  it('should return empty dailyUpdates when no rawReplies', () => {
    const parsedNoReplies = {
      ...parsed,
      dateEntries: {
        '3/6': { ...parsed.dateEntries['3/6'], rawReplies: undefined },
      },
    };
    const result = mergeDailyData(existing, parsedNoReplies);
    expect(result.dailyUpdates).toEqual([]);
  });

  describe('multi-space add-missing-member (Phase 2)', () => {
    it('ADDs member to an existing date when previously absent', () => {
      // raw_data has 5/14 with 工程 members only; new parsed output from 技發
      // space brings Richard into the same date.
      const existing5_14 = {
        rawData: {
          '5/14': {
            Joyce: { total: 8, meeting: 1, dev: 7 },
            Ivy: { total: 7, meeting: 0, dev: 7 },
          },
        },
        issues: [],
        leave: {},
      };
      const parsedTechDev = {
        dateEntries: {
          '5/14': {
            threadDate: '5/15',
            contentDate: '5/14',
            entry: {
              Richard: { total: 6, meeting: 0, dev: 6, status: 'reported' },
              Patty: { total: 7, meeting: 0, dev: 7, status: 'reported' },
            },
            alreadyExists: true,
            reportedCount: 2,
            totalMembers: 2,
            rawReplies: [
              { member: 'Richard', text: '5/14 進度：\n1. [BDE] X (6H)', createTime: '2026-05-15T01:00:00Z' },
              { member: 'Patty', text: '5/14 進度：\n1. [BDE] Y (7H)', createTime: '2026-05-15T02:00:00Z' },
            ],
          },
        },
        leaveMap: {},
        issues: [],
      };
      const result = mergeDailyData(existing5_14, parsedTechDev);
      expect(result.rawData['5/14'].Joyce.total).toBe(8);
      expect(result.rawData['5/14'].Richard).toBeDefined();
      expect(result.rawData['5/14'].Richard.total).toBe(6);
      expect(result.rawData['5/14'].Patty.total).toBe(7);
      // newDates stays empty (date already existed); addedToExisting should track the additions.
      expect(result.newDates).toEqual([]);
      expect(result.addedToExisting).toBeDefined();
      const adds = result.addedToExisting.filter((a) => a.date === '5/14').map((a) => a.member).sort();
      expect(adds).toEqual(['Patty', 'Richard']);
      // Daily updates for newly added members should be present.
      const richardUpdate = result.dailyUpdates.find((u) => u.member === 'Richard' && u.date === '5/14');
      expect(richardUpdate).toBeDefined();
    });

    it('does not overwrite an existing reported entry with one from another space', () => {
      const existingWithRichard = {
        rawData: {
          '5/14': {
            Richard: { total: 6, meeting: 0, dev: 6 },
          },
        },
        issues: [],
        leave: {},
      };
      const parsedOverlap = {
        dateEntries: {
          '5/14': {
            entry: { Richard: { total: 99, meeting: 99, dev: 0 } },
            alreadyExists: true,
          },
        },
        leaveMap: {},
      };
      const result = mergeDailyData(existingWithRichard, parsedOverlap);
      expect(result.rawData['5/14'].Richard.total).toBe(6);
      expect(result.addedToExisting || []).toEqual([]);
    });

    it('sequential merge of two spaces produces same result as a combined parse', () => {
      // Hypothetical "combined" parse where both spaces are merged into one entry
      const combinedParse = {
        dateEntries: {
          '5/14': {
            entry: {
              Joyce: { total: 8, meeting: 1, dev: 7, status: 'reported' },
              Richard: { total: 6, meeting: 0, dev: 6, status: 'reported' },
            },
            alreadyExists: false,
          },
        },
        leaveMap: {},
      };
      const combined = mergeDailyData(
        { rawData: {}, issues: [], leave: {} },
        combinedParse
      );

      // Sequential: first 工程 (new date), then 技發 (adds member to existing date)
      const eng = mergeDailyData(
        { rawData: {}, issues: [], leave: {} },
        {
          dateEntries: {
            '5/14': {
              entry: { Joyce: { total: 8, meeting: 1, dev: 7, status: 'reported' } },
              alreadyExists: false,
            },
          },
          leaveMap: {},
        }
      );
      const tech = mergeDailyData(
        { rawData: eng.rawData, issues: eng.issues, leave: eng.leave },
        {
          dateEntries: {
            '5/14': {
              entry: { Richard: { total: 6, meeting: 0, dev: 6, status: 'reported' } },
              alreadyExists: true,
            },
          },
          leaveMap: {},
        }
      );
      expect(tech.rawData['5/14'].Joyce).toEqual(combined.rawData['5/14'].Joyce);
      expect(tech.rawData['5/14'].Richard).toEqual(combined.rawData['5/14'].Richard);
    });

    it('still backfills nulls AND adds missing members in the same merge', () => {
      const existingMixed = {
        rawData: {
          '5/14': {
            Joyce: { total: null, meeting: null, dev: null },
            Ivy: { total: 7, meeting: 0, dev: 7 },
          },
        },
        issues: [],
        leave: {},
      };
      const parsed = {
        dateEntries: {
          '5/14': {
            entry: {
              Joyce: { total: 8, meeting: 1, dev: 7, status: 'reported' },
              Richard: { total: 6, meeting: 0, dev: 6, status: 'reported' },
            },
            alreadyExists: true,
          },
        },
        leaveMap: {},
      };
      const result = mergeDailyData(existingMixed, parsed);
      expect(result.rawData['5/14'].Joyce.total).toBe(8);
      expect(result.rawData['5/14'].Richard.total).toBe(6);
      expect(result.rawData['5/14'].Ivy.total).toBe(7);
      expect(result.backfilled.map((b) => b.member)).toEqual(['Joyce']);
      expect(result.addedToExisting.map((a) => a.member)).toEqual(['Richard']);
    });
  });

  describe('items[] propagation (Phase 1)', () => {
    it('carries items array from parsed entry into rawData', () => {
      const parsedWithItems = {
        dateEntries: {
          '3/7': {
            entry: {
              Joyce: {
                total: 4,
                meeting: 1,
                dev: 3,
                status: 'reported',
                items: [
                  { code: 'KEYPO', task: '開發', hours: 3 },
                  { code: null, task: '週會', hours: 1 },
                ],
              },
            },
            alreadyExists: false,
          },
        },
        leaveMap: {},
        issues: [],
        warnings: [],
      };
      const result = mergeDailyData({ rawData: {}, issues: [], leave: {} }, parsedWithItems);
      expect(result.rawData['3/7'].Joyce.items).toHaveLength(2);
      expect(result.rawData['3/7'].Joyce.items[0]).toMatchObject({ code: 'KEYPO', hours: 3 });
    });

    it('leaves existing entries without items untouched (backward compat)', () => {
      const existingNoItems = {
        rawData: { '3/5': { Old: { total: 8, meeting: 0, dev: 8 } } },
        issues: [],
        leave: {},
      };
      const result = mergeDailyData(existingNoItems, { dateEntries: {}, leaveMap: {} });
      expect(result.rawData['3/5'].Old.items).toBeUndefined();
    });
  });

  describe('config metadata propagation (Phase 1)', () => {
    it('writes centers from config into output', () => {
      const config = {
        centers: {
          工程: { label: '工程部', members: ['Joyce', 'Ivy'] },
          產品: { label: '產品部', members: ['Alice'] },
        },
      };
      const result = mergeDailyData(
        { rawData: {}, issues: [], leave: {} },
        { dateEntries: {}, leaveMap: {} },
        config
      );
      expect(result.centers).toEqual(config.centers);
    });

    it('writes validCodes from config into output', () => {
      const config = {
        validCodes: {
          KEYPO: { label: 'KEYPO 系列', category: 'product' },
        },
      };
      const result = mergeDailyData(
        { rawData: {}, issues: [], leave: {} },
        { dateEntries: {}, leaveMap: {} },
        config
      );
      expect(result.validCodes).toEqual(config.validCodes);
    });

    it('preserves existing centers/validCodes when config omitted', () => {
      const existingWithMeta = {
        rawData: {},
        issues: [],
        leave: {},
        centers: { 工程: { label: '工程部', members: ['Joyce'] } },
        validCodes: { KEYPO: { label: 'KEYPO 系列' } },
      };
      const result = mergeDailyData(existingWithMeta, { dateEntries: {}, leaveMap: {} });
      expect(result.centers).toEqual(existingWithMeta.centers);
      expect(result.validCodes).toEqual(existingWithMeta.validCodes);
    });
  });
});
