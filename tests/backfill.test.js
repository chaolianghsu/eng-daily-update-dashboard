import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dataPath = resolve(__dirname, '..', 'raw_data.json');

let data;
beforeAll(() => {
  data = JSON.parse(readFileSync(dataPath, 'utf-8'));
});

describe('backfill-daily-updates: single date (3/3)', () => {
  it('should have date 3/3 in rawData', () => {
    expect(data.rawData).toHaveProperty('3/3');
  });

  it('3/3 should have valid member entries with total/meeting/dev', () => {
    const dayData = data.rawData['3/3'];
    expect(dayData).toBeDefined();
    const members = Object.keys(dayData);
    expect(members.length).toBeGreaterThan(0);
    members.forEach((member) => {
      const entry = dayData[member];
      expect(entry).toHaveProperty('total');
      expect(entry).toHaveProperty('meeting');
      expect(entry).toHaveProperty('dev');
      ['total', 'meeting', 'dev'].forEach((field) => {
        const val = entry[field];
        expect(val === null || typeof val === 'number').toBe(true);
      });
    });
  });

  it('should preserve existing dates unchanged', () => {
    // 2/23 Joyce should still be { total: 8.5, meeting: 3.5, dev: 5 }
    expect(data.rawData['2/23']).toBeDefined();
    expect(data.rawData['2/23']['Joyce']).toEqual({
      total: 8.5,
      meeting: 3.5,
      dev: 5,
    });
  });

  it('should NOT modify issues array', () => {
    expect(data.issues).toHaveLength(6);
    expect(data.issues[0]).toEqual({
      member: 'Ivy',
      severity: '🔴',
      text: '未回報 3/4',
    });
  });
});

describe('backfill-daily-updates: date range (2/26-2/28)', () => {
  const workdays = ['2/26', '2/27'];

  workdays.forEach((date) => {
    it(`should have date ${date} in rawData`, () => {
      expect(data.rawData).toHaveProperty(date);
    });

    it(`${date} should have valid member entries`, () => {
      const dayData = data.rawData[date];
      expect(dayData).toBeDefined();
      const members = Object.keys(dayData);
      expect(members.length).toBeGreaterThan(0);
      members.forEach((member) => {
        const entry = dayData[member];
        expect(entry).toHaveProperty('total');
        expect(entry).toHaveProperty('meeting');
        expect(entry).toHaveProperty('dev');
        ['total', 'meeting', 'dev'].forEach((field) => {
          const val = entry[field];
          expect(val === null || typeof val === 'number').toBe(true);
        });
      });
    });
  });

  it('should exclude weekend 2/28 (Saturday)', () => {
    expect(data.rawData).not.toHaveProperty('2/28');
  });

  it('should still have 6 issues (unchanged)', () => {
    expect(data.issues).toHaveLength(6);
  });
});
