import { describe, it, expect } from 'vitest';
import { mergeDailyData } from '../scripts/merge-daily-data.js';

describe('merge-daily-data parentCenters pass-through', () => {
  const baseExisting = {
    rawData: { '5/13': { Joyce: { total: 8, meeting: 0, dev: 8, status: 'reported' } } },
    issues: [],
    leave: {},
    centers: { '工程': { label: '工程部', members: ['Joyce'], parent: '產品中心' } },
    parentCenters: { '產品中心': { label: '產品中心', children: ['工程'] } },
  };
  const baseParsed = { dateEntries: {}, leaveMap: {} };

  it('preserves parentCenters from existing when no config override', () => {
    const out = mergeDailyData(baseExisting, baseParsed);
    expect(out.parentCenters).toEqual({ '產品中心': { label: '產品中心', children: ['工程'] } });
  });

  it('config.parentCenters overrides existing', () => {
    const config = { parentCenters: { '新中心': { label: '新中心', children: ['新部'] } } };
    const out = mergeDailyData(baseExisting, baseParsed, config);
    expect(out.parentCenters).toEqual({ '新中心': { label: '新中心', children: ['新部'] } });
  });

  it('omits parentCenters key when neither config nor existing has it', () => {
    const exNoPC = { ...baseExisting, parentCenters: undefined };
    const out = mergeDailyData(exNoPC, baseParsed);
    expect(out).not.toHaveProperty('parentCenters');
  });
});
