import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('collect-github-commits', () => {
  it('script file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'scripts', 'collect-github-commits.js'))).toBe(true);
  });

  it('fetch-github-commits exports collectGitHubCommits', () => {
    const mod = require('../scripts/fetch-github-commits');
    expect(typeof mod.collectGitHubCommits).toBe('function');
  });
});

const { parseLinkHeader, filterAndMapGitHubCommits } = require('../scripts/fetch-github-commits');

describe('GitHub API helpers', () => {
  describe('parseLinkHeader', () => {
    it('parses next page URL from Link header', () => {
      const header = '<https://api.github.com/orgs/bigdata-54837596/repos?page=2&per_page=100>; rel="next", <https://api.github.com/orgs/bigdata-54837596/repos?page=5&per_page=100>; rel="last"';
      expect(parseLinkHeader(header)).toBe('https://api.github.com/orgs/bigdata-54837596/repos?page=2&per_page=100');
    });

    it('returns null when no next link', () => {
      const header = '<https://api.github.com/orgs/bigdata-54837596/repos?page=5&per_page=100>; rel="last"';
      expect(parseLinkHeader(header)).toBe(null);
    });

    it('returns null for empty/null header', () => {
      expect(parseLinkHeader(null)).toBe(null);
      expect(parseLinkHeader('')).toBe(null);
    });
  });

  describe('filterAndMapGitHubCommits', () => {
    const memberMap = { 'johndoe': '成員A', 'janedoe': '成員B' };
    const excludeAuthors = ['dependabot[bot]'];

    it('maps author login to member name', () => {
      const commits = [{
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        commit: { message: 'fix bug', committer: { date: '2026-03-19T10:00:00Z' } },
        author: { login: 'johndoe' },
        html_url: 'https://github.com/org/repo/commit/abcdef12'
      }];
      const result = filterAndMapGitHubCommits(commits, 'org/repo', memberMap, excludeAuthors);
      expect(result).toHaveLength(1);
      expect(result[0].member).toBe('成員A');
      expect(result[0].source).toBe('github');
      expect(result[0].sha).toBe('abcdef12');
      expect(result[0].unmapped).toBe(false);
    });

    it('excludes bots', () => {
      const commits = [{
        sha: 'abcd1234abcd1234abcd1234abcd1234abcd1234',
        commit: { message: 'bump dep', committer: { date: '2026-03-19T10:00:00Z' } },
        author: { login: 'dependabot[bot]' },
        html_url: null
      }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result).toHaveLength(0);
    });

    it('marks unmapped authors', () => {
      const commits = [{
        sha: '1234abcd1234abcd1234abcd1234abcd1234abcd',
        commit: { message: 'test', committer: { date: '2026-03-19T10:00:00Z' } },
        author: { login: 'unknownuser' },
        html_url: null
      }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result[0].unmapped).toBe(true);
      expect(result[0].member).toBe('unknownuser');
    });

    it('handles null author (CLI commits)', () => {
      const commits = [{
        sha: 'deadbeef12345678deadbeef12345678deadbeef',
        commit: { message: 'test', committer: { date: '2026-03-19T10:00:00Z', name: 'John Doe' } },
        author: null,
        html_url: null
      }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result[0].member).toBe('John Doe');
      expect(result[0].unmapped).toBe(true);
    });

    it('truncates SHA to 8 characters', () => {
      const commits = [{
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        commit: { message: 'test', committer: { date: '2026-03-19T10:00:00Z' } },
        author: { login: 'johndoe' },
        html_url: null
      }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result[0].sha).toHaveLength(8);
      expect(result[0].sha).toBe('abcdef12');
    });

    it('uses first line of commit message as title', () => {
      const commits = [{
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        commit: { message: 'first line\n\nsecond paragraph', committer: { date: '2026-03-19T10:00:00Z' } },
        author: { login: 'johndoe' },
        html_url: null
      }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result[0].title).toBe('first line');
    });
  });
});
