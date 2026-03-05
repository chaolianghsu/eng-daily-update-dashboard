import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dataPath = resolve(__dirname, '..', 'raw_data.json');
let data;

try {
  data = JSON.parse(readFileSync(dataPath, 'utf-8'));
} catch {
  data = null;
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
});
