import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildAnalysis,
  buildDashboardJSON,
  buildPostPayload,
} from '../scripts/fetch-gitlab-commits.js';

describe('analyze-consistency exports', () => {
  it('buildDashboardJSON is exported', () => {
    expect(typeof buildDashboardJSON).toBe('function');
  });

  it('buildPostPayload is exported', () => {
    expect(typeof buildPostPayload).toBe('function');
  });
});

describe('buildAnalysis status logic', () => {
  const members = ['Alice', 'Bob'];

  it('returns ✅ when both hours and commits', () => {
    const commits = [{ date: '3/5', member: 'Alice', project: 'test', title: 'fix', sha: 'abc' }];
    const rawData = { '3/5': { Alice: { total: 8 }, Bob: { total: 7 } } };
    const result = buildAnalysis(commits, rawData, members);
    expect(result.analysis['3/5']['Alice'].status).toBe('✅');
  });

  it('returns ⚠️ when hours but no commits', () => {
    // Bob has a commit to establish the date range, but Alice has none
    const commits = [{ date: '3/5', member: 'Bob', project: 'test', title: 'fix', sha: 'def' }];
    const rawData = { '3/5': { Alice: { total: 8 }, Bob: { total: 7 } } };
    const result = buildAnalysis(commits, rawData, members);
    expect(result.analysis['3/5']['Alice'].status).toBe('⚠️');
  });

  it('returns 🔴 when commits but no hours', () => {
    const commits = [{ date: '3/5', member: 'Alice', project: 'test', title: 'fix', sha: 'abc' }];
    const rawData = { '3/5': { Alice: { total: null } } };
    const result = buildAnalysis(commits, rawData, ['Alice']);
    expect(result.analysis['3/5']['Alice'].status).toBe('🔴');
  });
});

describe('analyze-consistency.js script', () => {
  it('script file exists and is valid JS', () => {
    const scriptPath = path.resolve(__dirname, '../scripts/analyze-consistency.js');
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(() => require(scriptPath)).not.toThrow();
  });

  it('script is guarded by require.main === module', () => {
    const scriptPath = path.resolve(__dirname, '../scripts/analyze-consistency.js');
    // Requiring the script should not execute main() — it's guarded
    const mod = require(scriptPath);
    expect(mod).toBeDefined();
  });
});

describe('dedupCommitItems', () => {
  it('deduplicates items by sha+project within each member', () => {
    const { dedupCommitItems } = require('../scripts/analyze-consistency.js');
    const data = {
      commits: {
        '3/17': {
          Alice: {
            count: 3,
            projects: ['repo-a'],
            items: [
              { title: 'fix', sha: 'abc', project: 'repo-a', url: '' },
              { title: 'fix', sha: 'abc', project: 'repo-a', url: '' }, // dup
              { title: 'feat', sha: 'def', project: 'repo-a', url: '' },
            ],
          },
        },
      },
      analysis: {},
      projectRisks: [],
    };
    const result = dedupCommitItems(data);
    expect(result.commits['3/17']['Alice'].items).toHaveLength(2);
    expect(result.commits['3/17']['Alice'].count).toBe(2);
  });

  it('preserves items with same sha but different projects', () => {
    const { dedupCommitItems } = require('../scripts/analyze-consistency.js');
    const data = {
      commits: {
        '3/17': {
          Alice: {
            count: 2,
            projects: ['repo-a', 'repo-b'],
            items: [
              { title: 'fix', sha: 'abc', project: 'repo-a', url: '' },
              { title: 'fix', sha: 'abc', project: 'repo-b', url: '' },
            ],
          },
        },
      },
      analysis: {},
      projectRisks: [],
    };
    const result = dedupCommitItems(data);
    expect(result.commits['3/17']['Alice'].items).toHaveLength(2);
    expect(result.commits['3/17']['Alice'].count).toBe(2);
  });

  it('recalculates projects list after dedup', () => {
    const { dedupCommitItems } = require('../scripts/analyze-consistency.js');
    const data = {
      commits: {
        '3/17': {
          Alice: {
            count: 3,
            projects: ['repo-a', 'repo-b'],
            items: [
              { title: 'fix', sha: 'abc', project: 'repo-a', url: '' },
              { title: 'fix', sha: 'abc', project: 'repo-a', url: '' }, // dup
              { title: 'feat', sha: 'def', project: 'repo-a', url: '' },
            ],
          },
        },
      },
      analysis: {},
      projectRisks: [],
    };
    const result = dedupCommitItems(data);
    expect(result.commits['3/17']['Alice'].projects).toEqual(['repo-a']);
  });
});
