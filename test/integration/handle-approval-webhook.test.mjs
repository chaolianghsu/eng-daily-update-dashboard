// Integration tests for scripts/handle-approval-webhook.mjs — Task D3.
// See docs/superpowers/plans/2026-04-22-issue-routing.md

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { migrate } from '../../scripts/migrate.mjs';
import { createStateStore } from '../../lib/state.mjs';
import { GitLabApiError } from '../../lib/gitlab-client.mjs';
import {
  handleApprove,
  handleEdit,
  handleDismiss,
  buildHttpServer,
} from '../../scripts/handle-approval-webhook.mjs';

const INTERNAL = 'super-secret-internal';

function silentLogger() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function seedPendingIssue(store, uid, {
  analysis = {
    summary: 'Sample issue analysis summary',
    suggested_repos: ['bigdata/keypo-agent'],
    suggested_assignees: ['alice'],
    confidence: 0.9,
    plan_draft: ['step 1', 'step 2'],
    action_token: 'tok-abc123',
  },
  ts = 1000,
  webUrl = 'https://gitlab.example.com/techcenter/reportcenter/-/issues/42',
} = {}) {
  store.upsert({
    issue_uid: uid,
    gitlab_url: webUrl,
    labels: ['K5'],
    last_analysis_hash: 'abcd1234',
    last_analysis_json: JSON.stringify(analysis),
    status: 'open',
    approval_status: 'pending',
    created_at: ts,
    updated_at: ts,
  });
}

function makeGitlabClient({ postIssueComment } = {}) {
  return {
    postIssueComment:
      postIssueComment ||
      vi.fn().mockResolvedValue({
        id: 99001,
        body: '(noop)',
      }),
  };
}

describe('handle-approval-webhook: handleApprove', () => {
  let tmp, dbPath, store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'approve-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it('approve success: posts comment, state updated with approved status', async () => {
    seedPendingIssue(store, '631:42');
    const postIssueComment = vi.fn().mockResolvedValue({
      id: 12345,
    });
    const gitlabClient = makeGitlabClient({ postIssueComment });

    const res = await handleApprove({
      stateStore: store,
      gitlabClient,
      issueUid: '631:42',
      actionToken: 'tok-abc123',
      userId: 'users/u1',
      now: () => 5000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.gitlab_note_id).toBe(12345);
    expect(res.body.gitlab_note_url).toContain('#note_12345');

    // postIssueComment called with correct args
    expect(postIssueComment).toHaveBeenCalledTimes(1);
    const [projectPath, iid, body] = postIssueComment.mock.calls[0];
    expect(projectPath).toBe('techcenter/reportcenter');
    expect(iid).toBe('42');
    expect(body).toContain('Sample issue analysis summary');
    expect(body).toContain('bigdata/keypo-agent');
    expect(body).toContain('Approved');

    const row = store.get('631:42');
    expect(row.approval_status).toBe('approved');
    expect(row.approved_by).toBe('users/u1');
    expect(row.approved_at).toBe(5000);
    expect(row.gitlab_comment_id).toBe('12345');
  });

  it('approve when already approved: 409 with "already approved by X"', async () => {
    seedPendingIssue(store, '631:42');
    // Mark as already approved
    store.upsert({
      issue_uid: '631:42',
      gitlab_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/42',
      labels: ['K5'],
      last_analysis_hash: 'abcd1234',
      last_analysis_json: JSON.stringify({ action_token: 'tok-abc123' }),
      status: 'open',
      approval_status: 'approved',
      approved_by: 'users/earlier',
      approved_at: 2000,
      gitlab_comment_id: '7777',
      created_at: 1000,
      updated_at: 2000,
    });

    const gitlabClient = makeGitlabClient();
    const res = await handleApprove({
      stateStore: store,
      gitlabClient,
      issueUid: '631:42',
      actionToken: 'tok-abc123',
      userId: 'users/u1',
      now: () => 5000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already approved/i);
    expect(res.body.error).toContain('users/earlier');
    expect(gitlabClient.postIssueComment).not.toHaveBeenCalled();
  });

  it('approve with wrong action_token: 403', async () => {
    seedPendingIssue(store, '631:42');
    const gitlabClient = makeGitlabClient();

    const res = await handleApprove({
      stateStore: store,
      gitlabClient,
      issueUid: '631:42',
      actionToken: 'tok-WRONG',
      userId: 'users/u1',
      now: () => 5000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(403);
    expect(gitlabClient.postIssueComment).not.toHaveBeenCalled();
  });

  it('approve when issue not in state: 404', async () => {
    const gitlabClient = makeGitlabClient();

    const res = await handleApprove({
      stateStore: store,
      gitlabClient,
      issueUid: '631:999',
      actionToken: 'tok-abc123',
      userId: 'users/u1',
      now: () => 5000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(404);
    expect(gitlabClient.postIssueComment).not.toHaveBeenCalled();
  });

  it('approve: GitLabApiError 500 during post → state NOT updated, returns 500', async () => {
    seedPendingIssue(store, '631:42');
    const postIssueComment = vi
      .fn()
      .mockRejectedValue(
        new GitLabApiError('GitLab 500 Server Error', {
          status: 500,
          endpoint: '/x',
          retries: 0,
        }),
      );
    const gitlabClient = makeGitlabClient({ postIssueComment });

    const res = await handleApprove({
      stateStore: store,
      gitlabClient,
      issueUid: '631:42',
      actionToken: 'tok-abc123',
      userId: 'users/u1',
      now: () => 5000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/gitlab/i);

    // State preserved for retry
    const row = store.get('631:42');
    expect(row.approval_status).toBe('pending');
    expect(row.approved_by).toBeNull();
    expect(row.gitlab_comment_id).toBeNull();
  });
});

describe('handle-approval-webhook: handleEdit', () => {
  let tmp, dbPath, store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'edit-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it('edit success: uses edit_body as comment, state=edited', async () => {
    seedPendingIssue(store, '631:50');
    const postIssueComment = vi.fn().mockResolvedValue({ id: 55555 });
    const gitlabClient = makeGitlabClient({ postIssueComment });

    const res = await handleEdit({
      stateStore: store,
      gitlabClient,
      issueUid: '631:50',
      actionToken: 'tok-abc123',
      userId: 'users/u2',
      editBody: '## Custom IC-edited plan\nDo this differently.',
      now: () => 6000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('edited');
    expect(res.body.gitlab_note_id).toBe(55555);

    const [, , body] = postIssueComment.mock.calls[0];
    expect(body).toContain('Custom IC-edited plan');
    expect(body).toContain('Edited & approved');

    const row = store.get('631:50');
    expect(row.approval_status).toBe('edited');
    expect(row.approved_by).toBe('users/u2');
  });

  it('edit with missing edit_body: 400', async () => {
    seedPendingIssue(store, '631:50');
    const gitlabClient = makeGitlabClient();

    const res = await handleEdit({
      stateStore: store,
      gitlabClient,
      issueUid: '631:50',
      actionToken: 'tok-abc123',
      userId: 'users/u2',
      editBody: '',
      now: () => 6000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(400);
    expect(gitlabClient.postIssueComment).not.toHaveBeenCalled();
  });
});

describe('handle-approval-webhook: handleDismiss', () => {
  let tmp, dbPath, store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dismiss-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it('dismiss success: no GitLab call, state=dismissed', async () => {
    seedPendingIssue(store, '631:60');
    const gitlabClient = makeGitlabClient();

    const res = await handleDismiss({
      stateStore: store,
      gitlabClient,
      issueUid: '631:60',
      actionToken: 'tok-abc123',
      userId: 'users/u3',
      now: () => 7000,
      logger: silentLogger(),
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dismissed');
    expect(gitlabClient.postIssueComment).not.toHaveBeenCalled();

    const row = store.get('631:60');
    expect(row.approval_status).toBe('dismissed');
    expect(row.approved_by).toBe('users/u3');
    expect(row.approved_at).toBe(7000);
    expect(row.gitlab_comment_id).toBeNull();
  });
});

// HTTP server surface tests: exercise routing + auth header plumbing without
// actually binding to a port. We invoke the server's request listener directly.
describe('handle-approval-webhook: buildHttpServer', () => {
  let tmp, dbPath, store, server;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'server-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    try {
      if (server && typeof server.close === 'function') server.close();
    } catch {}
    try {
      store.close();
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  async function callHandler(handler, { method, url, headers, body }) {
    const reqChunks = body == null ? [] : [Buffer.from(body, 'utf8')];
    const req = makeMockRequest({ method, url, headers, chunks: reqChunks });
    const res = makeMockResponse();
    await new Promise((resolve, reject) => {
      res.onEnd = resolve;
      res.onError = reject;
      try {
        handler(req, res);
        // push body chunks async to mirror real streams
        setImmediate(() => {
          for (const c of reqChunks) req.emit('data', c);
          req.emit('end');
        });
      } catch (e) {
        reject(e);
      }
    });
    return res;
  }

  it('missing X-Internal-Auth header → 401', async () => {
    seedPendingIssue(store, '631:42');
    const gitlabClient = makeGitlabClient();
    server = buildHttpServer({
      stateStore: store,
      gitlabClient,
      internalToken: INTERNAL,
      logger: silentLogger(),
      now: () => 5000,
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    const res = await callHandler(server._handler, {
      method: 'POST',
      url: '/approve',
      headers: {},
      body: JSON.stringify({
        issue_uid: '631:42',
        action_token: 'tok-abc123',
        user_id: 'users/u1',
      }),
    });

    expect(res.statusCode).toBe(401);
    expect(gitlabClient.postIssueComment).not.toHaveBeenCalled();
  });

  it('unknown endpoint → 400', async () => {
    const gitlabClient = makeGitlabClient();
    server = buildHttpServer({
      stateStore: store,
      gitlabClient,
      internalToken: INTERNAL,
      logger: silentLogger(),
      now: () => 5000,
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    const res = await callHandler(server._handler, {
      method: 'POST',
      url: '/bogus',
      headers: { 'x-internal-auth': INTERNAL },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /approve with valid auth → dispatches handleApprove and returns 200', async () => {
    seedPendingIssue(store, '631:42');
    const postIssueComment = vi.fn().mockResolvedValue({ id: 77 });
    const gitlabClient = makeGitlabClient({ postIssueComment });

    server = buildHttpServer({
      stateStore: store,
      gitlabClient,
      internalToken: INTERNAL,
      logger: silentLogger(),
      now: () => 5000,
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    const res = await callHandler(server._handler, {
      method: 'POST',
      url: '/approve',
      headers: { 'x-internal-auth': INTERNAL },
      body: JSON.stringify({
        issue_uid: '631:42',
        action_token: 'tok-abc123',
        user_id: 'users/u1',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.bodyText);
    expect(body.status).toBe('approved');
    expect(body.gitlab_note_id).toBe(77);
  });
});

// ---------- minimal stream mocks ----------
// We build tiny EventEmitter-based req/res objects so we can exercise the
// HTTP handler without binding to a socket.

import { EventEmitter } from 'events';

function makeMockRequest({ method, url, headers }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return req;
}

function makeMockResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res._headers = {};
  res.setHeader = (k, v) => {
    res._headers[k.toLowerCase()] = v;
  };
  res.getHeader = (k) => res._headers[k.toLowerCase()];
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    }
  };
  res.bodyText = '';
  res.write = (chunk) => {
    res.bodyText += chunk.toString();
    return true;
  };
  res.end = (chunk) => {
    if (chunk != null) res.bodyText += chunk.toString();
    if (typeof res.onEnd === 'function') res.onEnd();
  };
  return res;
}
