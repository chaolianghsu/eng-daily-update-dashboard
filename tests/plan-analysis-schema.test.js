import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const dataPath = resolve(__dirname, '..', 'public', 'plan-analysis.json');
const fileExists = existsSync(dataPath);

let data;
if (fileExists) {
  try {
    data = JSON.parse(readFileSync(dataPath, 'utf-8'));
  } catch {
    data = null;
  }
}

describe('plan-analysis.json schema validation', () => {
  it.skipIf(!fileExists)('should be parseable JSON', () => {
    expect(data).not.toBeNull();
    expect(typeof data).toBe('object');
  });

  describe('top-level structure', () => {
    it.skipIf(!fileExists)('should have analysisDate as a string', () => {
      expect(data).toHaveProperty('analysisDate');
      expect(typeof data.analysisDate).toBe('string');
    });

    it.skipIf(!fileExists)('should have period as a string in M/D-M/D format', () => {
      expect(data).toHaveProperty('period');
      expect(typeof data.period).toBe('string');
      expect(data.period).toMatch(/^\d{1,2}\/\d{1,2}-\d{1,2}\/\d{1,2}$/);
    });

    it.skipIf(!fileExists)('should have planSpecs as an array', () => {
      expect(data).toHaveProperty('planSpecs');
      expect(Array.isArray(data.planSpecs)).toBe(true);
    });

    it.skipIf(!fileExists)('should have summary object', () => {
      expect(data).toHaveProperty('summary');
      expect(typeof data.summary).toBe('object');
    });

    it.skipIf(!fileExists)('correlations should be an array if present', () => {
      if (data.correlations !== undefined) {
        expect(Array.isArray(data.correlations)).toBe(true);
      }
    });
  });

  describe('planSpecs items', () => {
    it.skipIf(!fileExists)('each item should have date, member, commit, files', () => {
      data.planSpecs.forEach((item) => {
        expect(typeof item.date).toBe('string');
        expect(item.date).toMatch(/^\d{1,2}\/\d{1,2}$/);

        expect(typeof item.member).toBe('string');

        expect(typeof item.commit).toBe('object');
        expect(typeof item.commit.title).toBe('string');
        expect(typeof item.commit.sha).toBe('string');
        expect(typeof item.commit.project).toBe('string');
        expect(typeof item.commit.url).toBe('string');
        expect(['gitlab', 'github']).toContain(item.commit.source);

        expect(Array.isArray(item.files)).toBe(true);
        item.files.forEach((f) => {
          expect(typeof f).toBe('string');
        });
      });
    });
  });

  describe('correlations', () => {
    it.skipIf(!fileExists)('each correlation should have required fields with valid status', () => {
      if (!data.correlations) return;
      const validStatuses = ['matched', 'unmatched', 'partial'];
      data.correlations.forEach((c) => {
        expect(typeof c.date).toBe('string');
        expect(c.date).toMatch(/^\d{1,2}\/\d{1,2}$/);

        expect(typeof c.member).toBe('string');

        expect(validStatuses).toContain(c.status);

        expect(typeof c.specCommits).toBe('number');
        expect(typeof c.dailyUpdateMention).toBe('boolean');

        expect(Array.isArray(c.matchedTasks)).toBe(true);
        c.matchedTasks.forEach((t) => expect(typeof t).toBe('string'));

        expect(Array.isArray(c.unmatchedSpecs)).toBe(true);
        c.unmatchedSpecs.forEach((s) => expect(typeof s).toBe('string'));

        expect(typeof c.reasoning).toBe('string');
      });
    });
  });

  describe('summary', () => {
    it.skipIf(!fileExists)('should have all required count fields as numbers', () => {
      const { summary } = data;
      expect(typeof summary.totalSpecCommits).toBe('number');
      expect(typeof summary.totalCorrelations).toBe('number');
      expect(typeof summary.membersWithSpecs).toBe('number');
      expect(typeof summary.matched).toBe('number');
      expect(typeof summary.unmatched).toBe('number');
      expect(typeof summary.partial).toBe('number');
    });

    it.skipIf(!fileExists)('summary counts should be consistent with correlations', () => {
      if (!data.correlations) return;
      const { summary, correlations } = data;

      expect(summary.totalCorrelations).toBe(correlations.length);

      const matchedCount = correlations.filter((c) => c.status === 'matched').length;
      const unmatchedCount = correlations.filter((c) => c.status === 'unmatched').length;
      const partialCount = correlations.filter((c) => c.status === 'partial').length;

      expect(summary.matched).toBe(matchedCount);
      expect(summary.unmatched).toBe(unmatchedCount);
      expect(summary.partial).toBe(partialCount);

      expect(summary.matched + summary.unmatched + summary.partial).toBe(summary.totalCorrelations);
    });
  });
});
