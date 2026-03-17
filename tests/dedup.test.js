import { describe, it, expect } from 'vitest';
import { buildDashboardJSON, buildAnalysis } from '../scripts/fetch-gitlab-commits.js';
import { mergeDailyData } from '../scripts/merge-daily-data.js';

describe('GitLab commit deduplication (buildDashboardJSON)', () => {
  it('deduplicates commits with same sha+project', () => {
    const commits = [
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix bug', sha: 'abc123', url: '' },
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix bug', sha: 'abc123', url: '' }, // duplicate
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'add feature', sha: 'def456', url: '' },
    ];
    const result = buildDashboardJSON(commits, {}, []);
    expect(result.commits['3/5']['Alice'].count).toBe(2); // not 3
    expect(result.commits['3/5']['Alice'].items).toHaveLength(2);
  });

  it('keeps commits with same sha but different projects', () => {
    const commits = [
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix', sha: 'abc123', url: '' },
      { date: '3/5', member: 'Alice', project: 'repo-b', title: 'fix', sha: 'abc123', url: '' }, // same sha, different project
    ];
    const result = buildDashboardJSON(commits, {}, []);
    expect(result.commits['3/5']['Alice'].count).toBe(2);
    expect(result.commits['3/5']['Alice'].items).toHaveLength(2);
  });

  it('handles empty commits array', () => {
    const result = buildDashboardJSON([], {}, []);
    expect(result.commits).toEqual({});
  });
});

describe('GitLab commit deduplication (buildAnalysis)', () => {
  it('does not double-count duplicate commits', () => {
    const commits = [
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix', sha: 'abc123' },
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix', sha: 'abc123' }, // duplicate
    ];
    const rawData = { '3/5': { Alice: { total: 8 } } };
    const result = buildAnalysis(commits, rawData, ['Alice']);
    expect(result.analysis['3/5']['Alice'].commitCount).toBe(1); // not 2
  });
});

describe('Daily updates deduplication (mergeDailyData)', () => {
  it('deduplicates dailyUpdates by date+member', () => {
    const existing = { rawData: {}, issues: [], leave: {} };
    const parsed = {
      dateEntries: {
        '3/5': {
          entry: { Alice: { total: 8, meeting: 2, dev: 6 } },
          rawReplies: [
            { member: 'Alice', createTime: '2026-03-05T10:00:00Z', text: 'task 1' },
            { member: 'Alice', createTime: '2026-03-05T10:00:00Z', text: 'task 1' }, // duplicate
          ],
        },
      },
    };
    const result = mergeDailyData(existing, parsed);
    expect(result.dailyUpdates).toHaveLength(1); // not 2
  });

  it('keeps different members on same date', () => {
    const existing = { rawData: {}, issues: [], leave: {} };
    const parsed = {
      dateEntries: {
        '3/5': {
          entry: {
            Alice: { total: 8, meeting: 2, dev: 6 },
            Bob: { total: 7, meeting: 1, dev: 6 },
          },
          rawReplies: [
            { member: 'Alice', createTime: '2026-03-05T10:00:00Z', text: 'task A' },
            { member: 'Bob', createTime: '2026-03-05T10:01:00Z', text: 'task B' },
          ],
        },
      },
    };
    const result = mergeDailyData(existing, parsed);
    expect(result.dailyUpdates).toHaveLength(2);
  });

  it('keeps different dates for same member', () => {
    const existing = { rawData: {}, issues: [], leave: {} };
    const parsed = {
      dateEntries: {
        '3/5': {
          entry: { Alice: { total: 8, meeting: 2, dev: 6 } },
          rawReplies: [{ member: 'Alice', createTime: '2026-03-05T10:00:00Z', text: 'day 1' }],
        },
        '3/6': {
          entry: { Alice: { total: 7, meeting: 1, dev: 6 } },
          rawReplies: [{ member: 'Alice', createTime: '2026-03-06T10:00:00Z', text: 'day 2' }],
        },
      },
    };
    const result = mergeDailyData(existing, parsed);
    expect(result.dailyUpdates).toHaveLength(2);
  });
});
