import { describe, it, expect } from 'vitest';
import { matchesSpecKeyword, isDocFile, filterSpecCommits } from '../scripts/detect-plan-specs.js';

describe('matchesSpecKeyword', () => {
  it('is exported as a function', () => {
    expect(typeof matchesSpecKeyword).toBe('function');
  });

  describe('English keyword matches', () => {
    it('matches "docs: add API design spec"', () => {
      expect(matchesSpecKeyword('docs: add API design spec')).toBe(true);
    });

    it('matches "feat: update plan document"', () => {
      expect(matchesSpecKeyword('feat: update plan document')).toBe(true);
    });

    it('matches "docs: RFC for auth flow"', () => {
      expect(matchesSpecKeyword('docs: RFC for auth flow')).toBe(true);
    });

    it('matches "refactor: update architecture"', () => {
      expect(matchesSpecKeyword('refactor: update architecture')).toBe(true);
    });
  });

  describe('Chinese keyword matches', () => {
    it('matches "新增 API 設計文件"', () => {
      expect(matchesSpecKeyword('新增 API 設計文件')).toBe(true);
    });

    it('matches "更新架構規劃"', () => {
      expect(matchesSpecKeyword('更新架構規劃')).toBe(true);
    });
  });

  describe('rejects non-spec commits', () => {
    it('rejects "fix: resolve login bug"', () => {
      expect(matchesSpecKeyword('fix: resolve login bug')).toBe(false);
    });

    it('rejects "feat: add user profile page"', () => {
      expect(matchesSpecKeyword('feat: add user profile page')).toBe(false);
    });

    it('rejects "chore: update dependencies"', () => {
      expect(matchesSpecKeyword('chore: update dependencies')).toBe(false);
    });
  });

  describe('excludes false positives', () => {
    it('rejects "fix: docker compose config"', () => {
      expect(matchesSpecKeyword('fix: docker compose config')).toBe(false);
    });

    it('rejects "chore: archive old logs"', () => {
      expect(matchesSpecKeyword('chore: archive old logs')).toBe(false);
    });

    it('rejects "feat: update Dockerfile"', () => {
      expect(matchesSpecKeyword('feat: update Dockerfile')).toBe(false);
    });
  });
});

describe('isDocFile', () => {
  it('is exported as a function', () => {
    expect(typeof isDocFile).toBe('function');
  });

  describe('matches doc directory paths', () => {
    it('matches "docs/specs/api-design.md"', () => {
      expect(isDocFile('docs/specs/api-design.md')).toBe(true);
    });

    it('matches "docs/plans/migration-plan.md"', () => {
      expect(isDocFile('docs/plans/migration-plan.md')).toBe(true);
    });

    it('matches "project/design/arch.md"', () => {
      expect(isDocFile('project/design/arch.md')).toBe(true);
    });
  });

  describe('matches root-level spec files', () => {
    it('matches "SPEC.md"', () => {
      expect(isDocFile('SPEC.md')).toBe(true);
    });

    it('matches "PLAN.md"', () => {
      expect(isDocFile('PLAN.md')).toBe(true);
    });

    it('matches "DESIGN.md"', () => {
      expect(isDocFile('DESIGN.md')).toBe(true);
    });

    it('matches "RFC-auth-flow.md"', () => {
      expect(isDocFile('RFC-auth-flow.md')).toBe(true);
    });
  });

  describe('rejects non-doc files', () => {
    it('rejects "src/utils.ts"', () => {
      expect(isDocFile('src/utils.ts')).toBe(false);
    });

    it('rejects "docs/specs/data.json"', () => {
      expect(isDocFile('docs/specs/data.json')).toBe(false);
    });

    it('rejects "README.md"', () => {
      expect(isDocFile('README.md')).toBe(false);
    });

    it('rejects "CHANGELOG.md"', () => {
      expect(isDocFile('CHANGELOG.md')).toBe(false);
    });
  });
});

describe('filterSpecCommits', () => {
  it('filters commits by keyword and returns candidates', () => {
    const commits = {
      '哲緯': {
        count: 3, projects: ['bigdata/api'],
        items: [
          { title: 'docs: add API design', sha: 'abc12345', project: 'bigdata/api', url: 'https://example.com/abc12345', source: 'gitlab' },
          { title: 'fix: login bug', sha: 'def67890', project: 'bigdata/api', url: 'https://example.com/def67890', source: 'gitlab' },
        ]
      }
    };
    const result = filterSpecCommits(commits);
    expect(result).toHaveLength(1);
    expect(result[0].commit.title).toBe('docs: add API design');
    expect(result[0].member).toBe('哲緯');
    expect(result[0].files).toEqual([]);
  });

  it('returns empty when no keywords match', () => {
    const commits = {
      'Ted': { count: 1, projects: ['sinyi/app'],
        items: [{ title: 'fix: button', sha: 'aaa', project: 'sinyi/app', url: '', source: 'gitlab' }]
      }
    };
    expect(filterSpecCommits(commits)).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(filterSpecCommits({})).toHaveLength(0);
    expect(filterSpecCommits(null)).toHaveLength(0);
  });

  it('collects candidates from multiple members', () => {
    const commits = {
      '哲緯': {
        count: 1, projects: ['bigdata/api'],
        items: [
          { title: 'docs: add spec', sha: 'aaa', project: 'bigdata/api', url: 'https://example.com/aaa', source: 'gitlab' },
        ]
      },
      '日銜': {
        count: 2, projects: ['sinyi/app'],
        items: [
          { title: 'feat: design new flow', sha: 'bbb', project: 'sinyi/app', url: 'https://example.com/bbb', source: 'github' },
          { title: 'fix: typo', sha: 'ccc', project: 'sinyi/app', url: 'https://example.com/ccc', source: 'github' },
        ]
      }
    };
    const result = filterSpecCommits(commits);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.member)).toContain('哲緯');
    expect(result.map(r => r.member)).toContain('日銜');
    // All should have empty files array initially
    result.forEach(r => expect(r.files).toEqual([]));
  });
});
