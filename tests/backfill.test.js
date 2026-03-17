import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dataPath = resolve(__dirname, '..', 'public', 'raw_data.json');

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

  it('should have valid issues array with correct severity format', () => {
    expect(data.issues.length).toBeGreaterThan(0);
    data.issues.forEach((issue) => {
      expect(issue).toHaveProperty('member');
      expect(issue).toHaveProperty('severity');
      expect(issue).toHaveProperty('text');
      expect(['🔴', '🟡', '🟠', '🟢']).toContain(issue.severity);
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

  it('should have valid issues array', () => {
    expect(data.issues.length).toBeGreaterThanOrEqual(9);
  });
});

describe('backfill-daily-updates: auto-detect (no argument)', () => {
  it('should have date 3/2 in rawData', () => {
    expect(data.rawData).toHaveProperty('3/2');
  });

  it('3/2 should have valid member entries', () => {
    const dayData = data.rawData['3/2'];
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

  it('should have valid issues array', () => {
    expect(data.issues.length).toBeGreaterThanOrEqual(9);
  });
});
