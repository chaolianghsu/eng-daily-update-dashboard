import { describe, it, expect } from 'vitest';
import { buildDashboardJSON, buildAnalysis, buildPostPayload } from '../scripts/fetch-gitlab-commits.js';
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

describe('GitLab commit deduplication (buildPostPayload)', () => {
  it('deduplicates commits with same sha+project in POST payload', () => {
    const commits = [
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix bug', sha: 'abc123', url: '' },
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'fix bug', sha: 'abc123', url: '' }, // duplicate
      { date: '3/5', member: 'Alice', project: 'repo-a', title: 'add feature', sha: 'def456', url: '' },
    ];
    const analysisResult = { analysis: {}, projectRisks: [] };
    const result = buildPostPayload(commits, analysisResult);
    expect(result.gitlabCommits).toHaveLength(2); // not 3
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

  it('excludes already-reported members from dailyUpdates during backfill', () => {
    // Scenario: Joyce already reported (total=8), Ivy is being backfilled (null→7)
    // dailyUpdates should only include Ivy, not re-send Joyce to Sheets
    const existing = {
      rawData: {
        '3/6': {
          Joyce: { total: 8, meeting: 2, dev: 6 },
          Ivy: { total: null, meeting: null, dev: null },
        },
      },
      issues: [],
      leave: {},
    };
    const parsed = {
      dateEntries: {
        '3/6': {
          entry: {
            Joyce: { total: 8, meeting: 2, dev: 6 },
            Ivy: { total: 7, meeting: 0, dev: 7 },
          },
          rawReplies: [
            { member: 'Joyce', createTime: '2026-03-07T01:30:00Z', text: 'already reported' },
            { member: 'Ivy', createTime: '2026-03-07T09:00:00Z', text: 'backfill reply' },
          ],
        },
      },
      leaveMap: {},
    };
    const result = mergeDailyData(existing, parsed);
    // Only Ivy's dailyUpdate should be included (backfilled)
    expect(result.dailyUpdates).toHaveLength(1);
    expect(result.dailyUpdates[0].member).toBe('Ivy');
  });

  it('includes all members for new dates in dailyUpdates', () => {
    // New date: all members should be in dailyUpdates
    const existing = { rawData: {}, issues: [], leave: {} };
    const parsed = {
      dateEntries: {
        '3/6': {
          entry: {
            Joyce: { total: 8, meeting: 2, dev: 6 },
            Ivy: { total: 7, meeting: 0, dev: 7 },
          },
          rawReplies: [
            { member: 'Joyce', createTime: '2026-03-07T01:30:00Z', text: 'task A' },
            { member: 'Ivy', createTime: '2026-03-07T02:00:00Z', text: 'task B' },
          ],
        },
      },
      leaveMap: {},
    };
    const result = mergeDailyData(existing, parsed);
    expect(result.dailyUpdates).toHaveLength(2);
  });

  it('excludes members with null data from dailyUpdates during backfill', () => {
    // Members who still have null (didn't backfill) should not be in dailyUpdates
    const existing = {
      rawData: {
        '3/6': {
          Joyce: { total: 8, meeting: 2, dev: 6 },
          Ivy: { total: null, meeting: null, dev: null },
          Ted: { total: null, meeting: null, dev: null },
        },
      },
      issues: [],
      leave: {},
    };
    const parsed = {
      dateEntries: {
        '3/6': {
          entry: {
            Joyce: { total: 8, meeting: 2, dev: 6 },
            Ivy: { total: 7, meeting: 0, dev: 7 },
            Ted: { total: null, meeting: null, dev: null },
          },
          rawReplies: [
            { member: 'Joyce', createTime: '2026-03-07T01:30:00Z', text: 'already done' },
            { member: 'Ivy', createTime: '2026-03-07T09:00:00Z', text: 'backfill' },
          ],
        },
      },
      leaveMap: {},
    };
    const result = mergeDailyData(existing, parsed);
    // Only Ivy (backfilled). Joyce excluded (already reported), Ted has no rawReply
    expect(result.dailyUpdates).toHaveLength(1);
    expect(result.dailyUpdates[0].member).toBe('Ivy');
  });
});
