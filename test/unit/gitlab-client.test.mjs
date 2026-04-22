// Unit tests for lib/gitlab-client.mjs — GitLab API wrapper.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task C1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGitLabClient, GitLabApiError } from '../../lib/gitlab-client.mjs';

// Zero-backoff override for tests — avoids multi-second sleeps in 5xx retry paths.
const ZERO_BACKOFF = [0, 0, 0];

describe('gitlab-client', () => {
  let mockFetch;
  let client;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = createGitLabClient({
      baseUrl: 'https://gitlab.example.com',
      token: 'secret-token',
      fetch: mockFetch,
      backoffMs: ZERO_BACKOFF,
    });
  });

  describe('fetchOpenIssues', () => {
    it('builds correct URL with headers and returns issue array', async () => {
      const issues = [
        { iid: 1, title: 'A', state: 'opened', labels: [], description: 'd' },
        { iid: 2, title: 'B', state: 'opened', labels: ['K5'], description: 'e' },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => issues,
      });

      const result = await client.fetchOpenIssues('techcenter/reportcenter');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('https://gitlab.example.com/api/v4/projects/techcenter%2Freportcenter/issues');
      expect(url).toContain('state=opened');
      expect(url).toContain('per_page=100');
      expect(url).toContain('order_by=updated_at');
      expect(url).toContain('sort=desc');
      expect(opts.headers).toEqual({ 'PRIVATE-TOKEN': 'secret-token' });
      expect(result).toEqual(issues);
    });

    it('adds updated_after param when `since` is provided', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
      const since = '2026-04-20T00:00:00Z';

      await client.fetchOpenIssues('x/y', { since });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`updated_after=${encodeURIComponent(since)}`);
    });

    it('throws GitLabApiError immediately on 401 with no retry', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const err = await client.fetchOpenIssues('x/y').catch((e) => e);
      expect(err).toBeInstanceOf(GitLabApiError);
      expect(err.status).toBe(401);
      expect(err.endpoint).toContain('/projects/x%2Fy/issues');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries 3 times on 503 then throws GitLabApiError', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const err = await client.fetchOpenIssues('x/y').catch((e) => e);
      expect(err).toBeInstanceOf(GitLabApiError);
      expect(err.status).toBe(503);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('retries on network errors (fetch throws)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));

      const err = await client.fetchOpenIssues('x/y').catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('returns empty array when no issues match', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
      const result = await client.fetchOpenIssues('x/y');
      expect(result).toEqual([]);
    });
  });

  describe('fetchIssue / fetchIssueNotes', () => {
    it('fetchIssue hits /projects/{encoded}/issues/{iid}', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ iid: 42 }) });
      const r = await client.fetchIssue('techcenter/reportcenter', 42);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/techcenter%2Freportcenter/issues/42');
      expect(r).toEqual({ iid: 42 });
    });

    it('fetchIssueNotes requests per_page=100 & sort=asc', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
      await client.fetchIssueNotes('a/b', 7);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/projects/a%2Fb/issues/7/notes');
      expect(url).toContain('per_page=100');
      expect(url).toContain('sort=asc');
    });
  });

  describe('postIssueComment (non-idempotent write)', () => {
    it('posts a note with JSON body and Content-Type header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 555, body: 'hi' }),
      });

      const r = await client.postIssueComment('a/b', 7, 'hi');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/a%2Fb/issues/7/notes');
      expect(opts.method).toBe('POST');
      expect(opts.headers['PRIVATE-TOKEN']).toBe('secret-token');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(opts.body)).toEqual({ body: 'hi' });
      expect(r).toEqual({ id: 555, body: 'hi' });
    });

    it('does NOT retry on 500 for write (fail fast — non-idempotent)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const err = await client.postIssueComment('a/b', 7, 'body').catch((e) => e);
      expect(err).toBeInstanceOf(GitLabApiError);
      expect(err.status).toBe(500);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveProjectId', () => {
    it('returns project.id from the project lookup', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 631, path_with_namespace: 'techcenter/reportcenter' }),
      });
      const id = await client.resolveProjectId('techcenter/reportcenter');
      expect(id).toBe(631);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/techcenter%2Freportcenter');
    });
  });

  describe('URL encoding', () => {
    it('encodes slashes in project paths as %2F', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
      await client.fetchOpenIssues('group/sub-group/project');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/projects/group%2Fsub-group%2Fproject/issues');
    });
  });
});
