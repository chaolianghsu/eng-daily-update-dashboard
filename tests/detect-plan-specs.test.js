import { describe, it, expect } from 'vitest';
import { matchesSpecKeyword } from '../scripts/detect-plan-specs.js';

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
