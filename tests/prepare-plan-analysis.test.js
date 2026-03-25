import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../scripts/prepare-plan-analysis.js';

describe('buildPrompt', () => {
  it('generates prompt with spec commits and daily updates', () => {
    const specs = [{
      date: '3/24', member: '哲緯',
      commit: { title: 'docs: API design', sha: 'abc123', project: 'bigdata/api', url: '', source: 'gitlab' },
      files: ['docs/specs/api.md']
    }];
    const dailyUpdates = [{ date: '3/24', member: '哲緯', text: '1. API 設計文件撰寫 (2H)' }];
    const prompt = buildPrompt(specs, dailyUpdates, '3/24');
    expect(prompt).toContain('哲緯');
    expect(prompt).toContain('docs/specs/api.md');
    expect(prompt).toContain('API 設計文件撰寫');
    expect(prompt).toContain('"status"');
    expect(prompt).toContain('matched');
  });

  it('handles empty daily updates', () => {
    const specs = [{
      date: '3/24', member: 'Ted',
      commit: { title: 'docs: add spec', sha: 'def456', project: 'sinyi/app', url: '', source: 'gitlab' },
      files: ['docs/specs/feature.md']
    }];
    const prompt = buildPrompt(specs, [], '3/24');
    expect(prompt).toContain('Ted');
    expect(prompt).toContain('無 daily update');
  });

  it('returns null when no specs', () => {
    expect(buildPrompt([], [], '3/24')).toBeNull();
  });

  it('groups multiple specs by member', () => {
    const specs = [
      {
        date: '3/24', member: '哲緯',
        commit: { title: 'docs: API design', sha: 'abc123', project: 'bigdata/api', url: '', source: 'gitlab' },
        files: ['docs/specs/api.md']
      },
      {
        date: '3/24', member: '哲緯',
        commit: { title: 'docs: DB schema', sha: 'xyz789', project: 'bigdata/api', url: '', source: 'gitlab' },
        files: ['docs/specs/db.md']
      },
    ];
    const dailyUpdates = [{ date: '3/24', member: '哲緯', text: '1. API + DB 設計 (4H)' }];
    const prompt = buildPrompt(specs, dailyUpdates, '3/24');
    // Both commits should appear
    expect(prompt).toContain('docs: API design');
    expect(prompt).toContain('docs: DB schema');
    // Member name should appear (at least once in a section header)
    const memberMatches = prompt.match(/哲緯/g);
    expect(memberMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('includes expected JSON output schema', () => {
    const specs = [{
      date: '3/24', member: 'Ted',
      commit: { title: 'docs: spec', sha: 'aaa', project: 'sinyi/app', url: '', source: 'gitlab' },
      files: ['docs/specs/x.md']
    }];
    const prompt = buildPrompt(specs, [], '3/24');
    expect(prompt).toContain('analysisDate');
    expect(prompt).toContain('planSpecs');
    expect(prompt).toContain('correlations');
    expect(prompt).toContain('summary');
    expect(prompt).toContain('totalSpecCommits');
    expect(prompt).toContain('matched');
    expect(prompt).toContain('unmatched');
    expect(prompt).toContain('partial');
  });

  it('only includes daily updates matching the dateArg', () => {
    const specs = [{
      date: '3/24', member: 'Ted',
      commit: { title: 'docs: spec', sha: 'aaa', project: 'sinyi/app', url: '', source: 'gitlab' },
      files: ['docs/specs/x.md']
    }];
    const dailyUpdates = [
      { date: '3/23', member: 'Ted', text: '昨天的工作' },
      { date: '3/24', member: 'Ted', text: '今天的規劃文件' },
    ];
    const prompt = buildPrompt(specs, dailyUpdates, '3/24');
    expect(prompt).toContain('今天的規劃文件');
    expect(prompt).not.toContain('昨天的工作');
  });
});
