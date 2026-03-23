import { describe, it, expect } from 'vitest';
import {
  parseDateArg,
  dateToMD,
  mdToISO,
  getPreviousWorkday,
} from '../scripts/fetch-gitlab-commits.js';

describe('date utilities', () => {
  it('parseDateArg single date "3/11" returns { since: "3/11", until: "3/11" }', () => {
    expect(parseDateArg('3/11')).toEqual({ since: '3/11', until: '3/11' });
  });

  it('parseDateArg range "3/9-3/12" returns { since: "3/9", until: "3/12" }', () => {
    expect(parseDateArg('3/9-3/12')).toEqual({ since: '3/9', until: '3/12' });
  });

  it('dateToMD converts ISO timestamp to M/D', () => {
    expect(dateToMD('2026-03-11T10:30:00+08:00')).toBe('3/11');
  });

  it('mdToISO converts M/D to ISO start-of-day in +08:00', () => {
    const iso = mdToISO('3/11');
    expect(iso).toMatch(/2026-03-11T00:00:00/);
  });

  it('mdToISO for until adds one day', () => {
    const iso = mdToISO('3/11', true);
    expect(iso).toMatch(/2026-03-12T00:00:00/);
  });

  it('getPreviousWorkday skips weekends', () => {
    // 2026-03-16 is Monday → previous workday is Friday 3/13
    const result = getPreviousWorkday(new Date(2026, 2, 16));
    expect(result).toBe('3/13');
  });

  it('getPreviousWorkday from Friday returns Thursday', () => {
    // 2026-03-13 is Friday → previous workday is Thursday 3/12
    const result = getPreviousWorkday(new Date(2026, 2, 13));
    expect(result).toBe('3/12');
  });
});

import { filterAndMapCommits } from '../scripts/fetch-gitlab-commits.js';

describe('filterAndMapCommits', () => {
  const memberMap = { 'joyce.kuo': 'Joyce', 'Ted Juang': 'Ted' };
  const excludeAuthors = ['GitLab CI'];

  it('maps known authors to member names', () => {
    const commits = [
      { author_name: 'joyce.kuo', committed_date: '2026-03-11T10:00:00+08:00', short_id: 'abc123', title: '[feat] test' },
    ];
    const result = filterAndMapCommits(commits, 'KEYPO/backend', memberMap, excludeAuthors);
    expect(result).toHaveLength(1);
    expect(result[0].member).toBe('Joyce');
    expect(result[0].project).toBe('KEYPO/backend');
  });

  it('filters out excluded authors', () => {
    const commits = [
      { author_name: 'GitLab CI', committed_date: '2026-03-11T10:00:00+08:00', short_id: 'ci1', title: 'CI build' },
    ];
    const result = filterAndMapCommits(commits, 'proj', memberMap, excludeAuthors);
    expect(result).toHaveLength(0);
  });

  it('includes source: "gitlab" in output', () => {
    const commits = [{ author_name: 'byron.you', committed_date: '2026-03-19T10:00:00+08:00', title: 'fix', short_id: '1234abcd', web_url: 'https://example.com' }];
    const result = filterAndMapCommits(commits, 'proj/repo', { 'byron.you': '日銜' }, []);
    expect(result[0].source).toBe('gitlab');
  });

  it('returns unmapped authors with original name and warning flag', () => {
    const commits = [
      { author_name: 'unknown.dev', committed_date: '2026-03-11T10:00:00+08:00', short_id: 'u1', title: 'fix' },
    ];
    const result = filterAndMapCommits(commits, 'proj', memberMap, excludeAuthors);
    expect(result).toHaveLength(1);
    expect(result[0].member).toBe('unknown.dev');
    expect(result[0].unmapped).toBe(true);
  });
});

import { buildDashboardJSON } from '../scripts/fetch-gitlab-commits.js';

describe('buildDashboardJSON', () => {
  it("buildDashboardJSON preserves datetime in commit items", () => {
    const commits = [{
      member: "A", date: "3/18", project: "p1", title: "fix bug",
      sha: "abc123", url: "https://example.com", unmapped: false,
      datetime: "2026-03-18T15:30:45+08:00",
    }];
    const analysis = { "3/18": { "A": { status: "✅", commitCount: 1, hours: 8 } } };
    const result = buildDashboardJSON(commits, analysis, []);
    expect(result.commits["3/18"]["A"].items[0].datetime).toBe("2026-03-18T15:30:45+08:00");
  });

  it('propagates source to items', () => {
    const commits = [
      { member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'p1', title: 'fix', sha: '1234abcd', url: 'http://x', unmapped: false, source: 'gitlab' },
    ];
    const result = buildDashboardJSON(commits, {}, []);
    expect(result.commits['3/19']['A'].items[0].source).toBe('gitlab');
  });
});

import { buildAnalysis } from '../scripts/fetch-gitlab-commits.js';

describe('buildAnalysis', () => {
  const rawData = {
    '3/11': {
      'Joyce': { total: 9, meeting: 1.5, dev: 7.5 },
      'Ted': { total: 7.5, meeting: 0, dev: 7.5 },
      'Aaron': { total: null, meeting: null, dev: null },
    },
  };
  const commits = [
    { member: 'Joyce', date: '3/11', project: 'backend', title: 'fix', sha: 'a1' },
    { member: 'Joyce', date: '3/11', project: 'backend', title: 'feat', sha: 'a2' },
    { member: 'Aaron', date: '3/11', project: 'agent', title: 'add', sha: 'b1' },
  ];
  const dailyUpdateMembers = ['Joyce', 'Ted', 'Aaron'];

  it('marks ✅ when both commits and hours present', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    expect(result.analysis['3/11']['Joyce'].status).toBe('✅');
    expect(result.analysis['3/11']['Joyce'].commitCount).toBe(2);
  });

  it('marks ⚠️ when hours reported but 0 commits', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    expect(result.analysis['3/11']['Ted'].status).toBe('⚠️');
  });

  it('marks 🔴 when commits exist but no daily update', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    expect(result.analysis['3/11']['Aaron'].status).toBe('🔴');
  });

  it('identifies single-contributor projects', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    const agentRisk = result.projectRisks.find(r => r.project === 'agent');
    expect(agentRisk).toBeDefined();
    expect(agentRisk.soloContributor).toBe('Aaron');
  });
});

import { buildPostPayload } from '../scripts/fetch-gitlab-commits.js';

describe('buildPostPayload', () => {
  it('includes source in commit entries', () => {
    const commits = [
      { member: 'A', date: '3/19', project: 'p1', title: 'fix', sha: '1234abcd', url: 'http://x', unmapped: false, source: 'gitlab' },
    ];
    const analysisResult = { analysis: { '3/19': { 'A': { status: '✅', commitCount: 1, hours: 8 } } }, projectRisks: [] };
    const result = buildPostPayload(commits, analysisResult);
    expect(result.gitlabCommits[0].source).toBe('gitlab');
  });
});
