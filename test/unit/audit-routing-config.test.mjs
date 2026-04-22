// Unit tests for scripts/audit-routing-config.mjs — monthly routing drift audit.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task D4.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  extractMentionedRepos,
  diffConfigVsActual,
  aggregateDrifts,
  formatDriftReport,
  runAudit,
} from '../../scripts/audit-routing-config.mjs';

const LABEL_CONFIG = {
  labels: {
    K5: {
      product: 'KEYPO',
      primary_group: 'KEYPO',
      known_exceptions: ['llmprojects/keypo-agent'],
    },
    BD: {
      product: 'BigData',
      primary_group: 'bigdata',
      known_exceptions: ['bigdata1'],
    },
  },
  ignore_for_routing: ['P1_高', 'Bug'],
};

describe('extractMentionedRepos', () => {
  it('extracts repo path from "mentioned in merge request" system note', () => {
    const notes = [
      { system: true, body: 'mentioned in merge request KEYPO/keypo-web!123' },
    ];
    const repos = extractMentionedRepos(notes);
    expect(repos.has('KEYPO/keypo-web')).toBe(true);
    expect(repos.size).toBe(1);
  });

  it('extracts repo path from "mentioned in commit PATH@SHA" system note', () => {
    const notes = [
      { system: true, body: 'mentioned in commit bigdata/foo@abc1234' },
    ];
    const repos = extractMentionedRepos(notes);
    expect(repos.has('bigdata/foo')).toBe(true);
  });

  it('handles multiple notes and nested paths', () => {
    const notes = [
      { system: true, body: 'mentioned in merge request group/sub/proj!9' },
      { system: true, body: 'mentioned in commit KEYPO/keypo-web@deadbee' },
      { system: false, body: 'regular user comment not system' },
    ];
    const repos = extractMentionedRepos(notes);
    expect(repos.has('group/sub/proj')).toBe(true);
    expect(repos.has('KEYPO/keypo-web')).toBe(true);
    expect(repos.size).toBe(2);
  });

  it('ignores non-system notes and unrelated system notes', () => {
    const notes = [
      { system: false, body: 'mentioned in merge request fake/repo!1' },
      { system: true, body: 'changed the description' },
    ];
    const repos = extractMentionedRepos(notes);
    expect(repos.size).toBe(0);
  });

  it('returns empty set for empty/null input', () => {
    expect(extractMentionedRepos([]).size).toBe(0);
    expect(extractMentionedRepos(null).size).toBe(0);
    expect(extractMentionedRepos(undefined).size).toBe(0);
  });
});

describe('diffConfigVsActual', () => {
  it('reports no drift when actual repo matches primary_group', () => {
    const issue = { iid: 42, labels: ['K5'] };
    const mentioned = new Set(['KEYPO/keypo-web']);
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].is_drift).toBe(false);
    expect(diffs[0].label).toBe('K5');
  });

  it('reports no drift when actual repo is in known_exceptions', () => {
    const issue = { iid: 43, labels: ['K5'] };
    const mentioned = new Set(['llmprojects/keypo-agent']);
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs[0].is_drift).toBe(false);
  });

  it('reports drift when actual repo is not predicted', () => {
    const issue = { iid: 44, labels: ['K5'] };
    const mentioned = new Set(['bigdata/foo']);
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].is_drift).toBe(true);
    expect(diffs[0].label).toBe('K5');
    expect(diffs[0].actual).toBe('bigdata/foo');
  });

  it('skips labels in ignore_for_routing', () => {
    const issue = { iid: 45, labels: ['P1_高', 'Bug'] };
    const mentioned = new Set(['bigdata/foo']);
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs).toHaveLength(0);
  });

  it('skips unknown labels not in config', () => {
    const issue = { iid: 46, labels: ['UnknownLabel'] };
    const mentioned = new Set(['any/repo']);
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs).toHaveLength(0);
  });

  it('returns empty array for issue with no mentioned repos', () => {
    const issue = { iid: 47, labels: ['K5'] };
    const mentioned = new Set();
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs).toHaveLength(0);
  });

  it('returns empty array for issue with no labels', () => {
    const issue = { iid: 48, labels: [] };
    const mentioned = new Set(['any/repo']);
    const diffs = diffConfigVsActual(issue, mentioned, LABEL_CONFIG);
    expect(diffs).toHaveLength(0);
  });
});

describe('aggregateDrifts', () => {
  it('aggregates drifts by (label, actual_repo) with count and sample iids', () => {
    const per = [
      { iid: 1, diffs: [{ label: 'K5', actual: 'bigdata/foo', is_drift: true }] },
      { iid: 2, diffs: [{ label: 'K5', actual: 'bigdata/foo', is_drift: true }] },
      { iid: 3, diffs: [{ label: 'K5', actual: 'bigdata/foo', is_drift: true }] },
      { iid: 4, diffs: [{ label: 'BD', actual: 'something/else', is_drift: true }] },
      { iid: 5, diffs: [{ label: 'K5', actual: 'KEYPO/keypo-web', is_drift: false }] },
    ];
    const agg = aggregateDrifts(per);
    const k5 = agg.find((d) => d.label === 'K5' && d.actual_repo === 'bigdata/foo');
    expect(k5.count).toBe(3);
    expect(k5.sample_iids).toEqual([1, 2, 3]);

    const bd = agg.find((d) => d.label === 'BD');
    expect(bd.count).toBe(1);
    expect(bd.sample_iids).toEqual([4]);

    // non-drift entries excluded
    expect(agg.find((d) => d.actual_repo === 'KEYPO/keypo-web')).toBeUndefined();
  });

  it('caps sample_iids at 5', () => {
    const per = [];
    for (let i = 1; i <= 8; i++) {
      per.push({ iid: i, diffs: [{ label: 'K5', actual: 'x/y', is_drift: true }] });
    }
    const agg = aggregateDrifts(per);
    expect(agg[0].count).toBe(8);
    expect(agg[0].sample_iids).toHaveLength(5);
  });

  it('returns empty array when no drifts', () => {
    const per = [
      { iid: 1, diffs: [{ label: 'K5', actual: 'KEYPO/keypo-web', is_drift: false }] },
    ];
    expect(aggregateDrifts(per)).toEqual([]);
  });
});

describe('formatDriftReport', () => {
  it('renders markdown with summary and per-label tables', () => {
    const md = formatDriftReport({
      audited: 47,
      drifts: [
        { label: 'K5', actual_repo: 'bigdata/foo', count: 3, sample_iids: [1, 2, 3] },
      ],
      period: '2026-04-21',
    });
    expect(md).toContain('# Routing Drift Audit');
    expect(md).toContain('2026-04-21');
    expect(md).toContain('47');
    expect(md).toContain('K5');
    expect(md).toContain('bigdata/foo');
    expect(md).toContain('Consider adding');
  });

  it('renders "No drift detected" when drifts is empty', () => {
    const md = formatDriftReport({ audited: 50, drifts: [], period: '2026-04-21' });
    expect(md).toContain('No drift detected 🟢');
    expect(md).toContain('50');
  });
});

describe('runAudit (integration of pure helpers + mocked client)', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'audit-'));
  });
  afterEach(() => {
    if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = null; }
  });

  it('audits closed issues, detects drift, writes markdown report', async () => {
    const closedIssues = [
      { iid: 101, labels: ['K5'], title: 'fix keypo thing' },
      { iid: 102, labels: ['K5'], title: 'big data leak' },
      { iid: 103, labels: [], title: 'untagged' },
    ];
    const notesByIid = {
      101: [{ system: true, body: 'mentioned in merge request KEYPO/keypo-web!5' }],
      102: [{ system: true, body: 'mentioned in commit bigdata/foo@abc' }],
      103: [{ system: true, body: 'mentioned in merge request x/y!1' }],
    };

    const client = {
      fetchClosedIssues: vi.fn(async () => closedIssues),
      fetchIssueNotes: vi.fn(async (_path, iid) => notesByIid[iid] ?? []),
    };

    const outputPath = join(tmp, 'report.md');
    const result = await runAudit({
      client,
      labelConfig: LABEL_CONFIG,
      projectPath: 'techcenter/reportcenter',
      outputPath,
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(result.audited).toBe(3);
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0].label).toBe('K5');
    expect(result.drifts[0].actual_repo).toBe('bigdata/foo');
    expect(result.reportPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
    const md = readFileSync(outputPath, 'utf8');
    expect(md).toContain('K5');
    expect(md).toContain('bigdata/foo');
    // untagged issue was not notes-fetched
    expect(client.fetchIssueNotes).toHaveBeenCalledWith('techcenter/reportcenter', 101);
    expect(client.fetchIssueNotes).toHaveBeenCalledWith('techcenter/reportcenter', 102);
    expect(client.fetchIssueNotes).not.toHaveBeenCalledWith('techcenter/reportcenter', 103);
  });

  it('writes "no drift" report when everything routes correctly', async () => {
    const client = {
      fetchClosedIssues: vi.fn(async () => [
        { iid: 1, labels: ['K5'] },
      ]),
      fetchIssueNotes: vi.fn(async () => [
        { system: true, body: 'mentioned in merge request KEYPO/keypo-web!1' },
      ]),
    };
    const outputPath = join(tmp, 'clean.md');
    const result = await runAudit({
      client,
      labelConfig: LABEL_CONFIG,
      projectPath: 'techcenter/reportcenter',
      outputPath,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(result.drifts).toHaveLength(0);
    const md = readFileSync(outputPath, 'utf8');
    expect(md).toContain('No drift detected 🟢');
  });
});
