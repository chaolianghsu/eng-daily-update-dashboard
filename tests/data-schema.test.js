import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dataPath = resolve(__dirname, '..', 'public', 'raw_data.json');
let data;

try {
  data = JSON.parse(readFileSync(dataPath, 'utf-8'));
} catch {
  data = null;
}

const commitDataPath = resolve(__dirname, '..', 'public', 'gitlab-commits.json');
let commitData;

try {
  commitData = JSON.parse(readFileSync(commitDataPath, 'utf-8'));
} catch {
  commitData = null;
}

describe('raw_data.json schema validation', () => {
  it('should be parseable JSON', () => {
    expect(data).not.toBeNull();
    expect(typeof data).toBe('object');
  });

  describe('rawData', () => {
    it('should be an object with M/D date-format keys', () => {
      expect(data).toHaveProperty('rawData');
      expect(typeof data.rawData).toBe('object');
      const keys = Object.keys(data.rawData);
      expect(keys.length).toBeGreaterThan(0);
      keys.forEach((key) => {
        expect(key).toMatch(/^\d{1,2}\/\d{1,2}$/);
      });
    });

    it('should have member entries containing total, meeting, dev', () => {
      const keys = Object.keys(data.rawData);
      keys.forEach((dateKey) => {
        const dayData = data.rawData[dateKey];
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
  });

  describe('issues', () => {
    it('should be an array of issue objects', () => {
      expect(data).toHaveProperty('issues');
      expect(Array.isArray(data.issues)).toBe(true);
    });

    it('each issue should have member (string), severity (emoji), and text (string)', () => {
      const validSeverities = ['\uD83D\uDD34', '\uD83D\uDFE1', '\uD83D\uDFE0', '\uD83D\uDFE2']; // 🔴 🟡 🟠 🟢
      data.issues.forEach((issue) => {
        expect(issue).toHaveProperty('member');
        expect(typeof issue.member).toBe('string');

        expect(issue).toHaveProperty('severity');
        expect(validSeverities).toContain(issue.severity);

        expect(issue).toHaveProperty('text');
        expect(typeof issue.text).toBe('string');
      });
    });
  });

  describe('leave (optional)', () => {
    it('if present, should be an object with member keys mapping to arrays of {start, end}', () => {
      if (!data.leave) return;
      expect(typeof data.leave).toBe('object');
      Object.entries(data.leave).forEach(([member, ranges]) => {
        expect(typeof member).toBe('string');
        expect(Array.isArray(ranges)).toBe(true);
        ranges.forEach((range) => {
          expect(range).toHaveProperty('start');
          expect(range).toHaveProperty('end');
          expect(range.start).toMatch(/^\d{1,2}\/\d{1,2}$/);
          expect(range.end).toMatch(/^\d{1,2}\/\d{1,2}$/);
        });
      });
    });
  });

  describe('items[] field (optional, Phase 1)', () => {
    it('if a member entry has items, each item has code, task, hours', () => {
      for (const [date, members] of Object.entries(data.rawData)) {
        for (const [member, entry] of Object.entries(members)) {
          if (!entry.items) continue;
          expect(Array.isArray(entry.items)).toBe(true);
          for (const item of entry.items) {
            expect(item).toHaveProperty('code');
            expect(item).toHaveProperty('task');
            expect(item).toHaveProperty('hours');
            expect(item.code === null || typeof item.code === 'string').toBe(true);
            expect(typeof item.task).toBe('string');
            expect(typeof item.hours).toBe('number');
            if (typeof item.code === 'string') {
              expect(item.code).toMatch(/^[A-Z][A-Z0-9-]{0,15}$/);
            }
          }
        }
      }
    });
  });

  describe('centers field (optional, Phase 1)', () => {
    it('if present, each center entry has label and members[]', () => {
      if (!data.centers) return;
      expect(typeof data.centers).toBe('object');
      for (const [key, center] of Object.entries(data.centers)) {
        expect(typeof key).toBe('string');
        expect(center).toHaveProperty('label');
        expect(center).toHaveProperty('members');
        expect(typeof center.label).toBe('string');
        expect(Array.isArray(center.members)).toBe(true);
        center.members.forEach(m => expect(typeof m).toBe('string'));
      }
    });
  });

  describe('validCodes field (optional, Phase 1)', () => {
    it('if present, each code entry has label and optional category/prefixes', () => {
      if (!data.validCodes) return;
      expect(typeof data.validCodes).toBe('object');
      const allowedCategories = ['product', 'platform', 'special', 'research'];
      for (const [code, info] of Object.entries(data.validCodes)) {
        expect(code).toMatch(/^[A-Z][A-Z0-9-]{0,15}$/);
        expect(info).toHaveProperty('label');
        expect(typeof info.label).toBe('string');
        if (info.category) {
          expect(allowedCategories).toContain(info.category);
        }
        if (info.gitlabProjectPrefixes) {
          expect(Array.isArray(info.gitlabProjectPrefixes)).toBe(true);
        }
      }
    });
  });

  describe('rawData status field (optional)', () => {
    it('rawData entries have valid status field', () => {
      const validStatuses = ['reported', 'unreported', 'replied_no_hours', 'zero', 'leave'];
      for (const [date, members] of Object.entries(data.rawData)) {
        for (const [member, entry] of Object.entries(members)) {
          if (entry.status) {
            expect(validStatuses).toContain(entry.status);
          }
        }
      }
    });
  });
});

describe('gitlab-commits.json schema validation', () => {
  it('commit items have optional datetime field', () => {
    if (!commitData) return;
    for (const [date, members] of Object.entries(commitData.commits)) {
      for (const [member, data] of Object.entries(members)) {
        for (const item of data.items) {
          if (item.datetime) {
            expect(new Date(item.datetime).toString()).not.toBe('Invalid Date');
          }
        }
      }
    }
  });
});
