// lib/gitlab-client.mjs — GitLab REST API wrapper (read issues/notes, write comments).
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task C1.
//
// Responsibilities:
//   - Typed error (GitLabApiError with .status / .endpoint / .retries)
//   - Retry 5xx + network errors with backoff; fail fast on 4xx
//   - Never retry non-idempotent writes (POST)
//   - URL-encode project paths (group/sub/proj → group%2Fsub%2Fproj)
//
// Not responsible for:
//   - Auth credential storage (caller passes token)
//   - Pagination (single-page per call; callers handle follow-up pages if needed)
//   - Business logic (routing, classification, state)

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = [1000, 5000, 15000];

export class GitLabApiError extends Error {
  constructor(message, { status, endpoint, retries } = {}) {
    super(message);
    this.name = 'GitLabApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.retries = retries;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createGitLabClient({
  baseUrl,
  token,
  fetch = globalThis.fetch,
  maxRetries = DEFAULT_MAX_RETRIES,
  backoffMs = DEFAULT_BACKOFF_MS,
}) {
  if (!baseUrl) throw new Error('createGitLabClient: baseUrl is required');
  if (!token) throw new Error('createGitLabClient: token is required');
  if (typeof fetch !== 'function') {
    throw new Error('createGitLabClient: fetch is not available (inject via options on Node < 18)');
  }

  async function apiCall(endpoint, { method = 'GET', body = null, idempotent = true } = {}) {
    const url = `${baseUrl}/api/v4${endpoint}`;
    const headers = { 'PRIVATE-TOKEN': token };
    if (body != null) headers['Content-Type'] = 'application/json';

    const attempts = idempotent ? maxRetries : 1;
    let lastError;

    for (let i = 0; i < attempts; i++) {
      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body != null ? JSON.stringify(body) : undefined,
        });
      } catch (networkErr) {
        // Network error — treat like 5xx (retry if idempotent).
        lastError = networkErr;
        if (i < attempts - 1) {
          await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0);
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return await response.json();
      }

      const status = response.status;
      // 4xx → throw immediately, never retry.
      if (status >= 400 && status < 500) {
        throw new GitLabApiError(
          `GitLab ${status} ${response.statusText || ''}`.trim(),
          { status, endpoint, retries: i },
        );
      }

      // 5xx (or other non-ok) → capture and maybe retry.
      lastError = new GitLabApiError(
        `GitLab ${status} ${response.statusText || ''}`.trim(),
        { status, endpoint, retries: i },
      );

      if (i < attempts - 1) {
        await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0);
      }
    }

    throw lastError;
  }

  function encodePath(projectPath) {
    return encodeURIComponent(projectPath);
  }

  return {
    async fetchOpenIssues(projectPath, { since = null } = {}) {
      const encoded = encodePath(projectPath);
      let path = `/projects/${encoded}/issues?state=opened&per_page=100&order_by=updated_at&sort=desc`;
      if (since) path += `&updated_after=${encodeURIComponent(since)}`;
      return apiCall(path);
    },

    async fetchIssue(projectPath, iid) {
      const encoded = encodePath(projectPath);
      return apiCall(`/projects/${encoded}/issues/${iid}`);
    },

    async fetchIssueNotes(projectPath, iid) {
      const encoded = encodePath(projectPath);
      return apiCall(`/projects/${encoded}/issues/${iid}/notes?per_page=100&sort=asc`);
    },

    async postIssueComment(projectPath, iid, body) {
      const encoded = encodePath(projectPath);
      return apiCall(`/projects/${encoded}/issues/${iid}/notes`, {
        method: 'POST',
        body: { body },
        idempotent: false, // writes are NOT retried — caller decides
      });
    },

    async resolveProjectId(projectPath) {
      const encoded = encodePath(projectPath);
      const proj = await apiCall(`/projects/${encoded}`);
      return proj.id;
    },
  };
}
