// Integration tests for scripts/collect-new-issues.mjs — Stage 1 of issue routing DAG.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task D1.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { migrate } from '../../scripts/migrate.mjs';
import { createStateStore } from '../../lib/state.mjs';
import { GitLabApiError } from '../../lib/gitlab-client.mjs';
import { hashIssueContent } from '../../lib/hash.mjs';
import { runCollect } from '../../scripts/collect-new-issues.mjs';

function makeIssue(overrides = {}) {
  return {
    iid: 1,
    title: 'sample issue',
    description: 'some description',
    labels: ['K5'],
    state: 'opened',
    web_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/1',
    ...overrides,
  };
}

function makeClient({ resolveProjectId, fetchOpenIssues } = {}) {
  return {
    resolveProjectId: resolveProjectId || vi.fn().mockResolvedValue(631),
    fetchOpenIssues: fetchOpenIssues || vi.fn().mockResolvedValue([]),
  };
}

function silentLogger() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('collect-new-issues (runCollect)', () => {
  let tmp, dbPath, store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'collect-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it('happy path: 3 new issues → 3 upserts', async () => {
    const issues = [
      makeIssue({ iid: 1, labels: ['K5'], description: 'a' }),
      makeIssue({ iid: 2, labels: ['BD'], description: 'b' }),
      makeIssue({ iid: 3, labels: ['DV'], description: 'c' }),
    ];
    const client = makeClient({
      resolveProjectId: vi.fn().mockResolvedValue(631),
      fetchOpenIssues: vi.fn().mockResolvedValue(issues),
    });

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    expect(summary.processed).toBe(3);
    expect(summary.queued).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(store.get('631:1')).not.toBeNull();
    expect(store.get('631:2')).not.toBeNull();
    expect(store.get('631:3')).not.toBeNull();
    expect(store.get('631:1').status).toBe('open');
    expect(JSON.parse(store.get('631:1').labels)).toEqual(['K5']);
  });

  it('skip path: existing rows with identical hash are not re-upserted', async () => {
    const issueA = makeIssue({ iid: 10, labels: ['K5'], description: 'aaa' });
    const issueB = makeIssue({ iid: 11, labels: ['BD'], description: 'bbb' });

    const hashA = hashIssueContent({ labels: issueA.labels, description: issueA.description, state: issueA.state });
    const hashB = hashIssueContent({ labels: issueB.labels, description: issueB.description, state: issueB.state });

    // Seed state with identical hashes + an older updated_at so we can detect non-update
    const seedTs = 500;
    store.upsert({
      issue_uid: '631:10', gitlab_url: issueA.web_url, labels: issueA.labels,
      last_analysis_hash: hashA, status: 'open', created_at: seedTs, updated_at: seedTs,
    });
    store.upsert({
      issue_uid: '631:11', gitlab_url: issueB.web_url, labels: issueB.labels,
      last_analysis_hash: hashB, status: 'open', created_at: seedTs, updated_at: seedTs,
    });

    const client = makeClient({
      fetchOpenIssues: vi.fn().mockResolvedValue([issueA, issueB]),
    });

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 9999,
    });

    expect(summary.processed).toBe(2);
    expect(summary.queued).toBe(0);
    expect(summary.skipped).toBe(2);
    // updated_at should NOT have changed
    expect(store.get('631:10').updated_at).toBe(seedTs);
    expect(store.get('631:11').updated_at).toBe(seedTs);
  });

  it('change path: existing row with different hash is upserted with new hash', async () => {
    const oldIssue = makeIssue({ iid: 20, labels: ['K5'], description: 'old text' });
    const oldHash = hashIssueContent({
      labels: oldIssue.labels,
      description: oldIssue.description,
      state: oldIssue.state,
    });
    const seedTs = 500;
    store.upsert({
      issue_uid: '631:20', gitlab_url: oldIssue.web_url, labels: oldIssue.labels,
      last_analysis_hash: oldHash, status: 'open', created_at: seedTs, updated_at: seedTs,
    });

    // Simulate: description changed
    const updatedIssue = { ...oldIssue, description: 'new text' };
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockResolvedValue([updatedIssue]),
    });

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1234,
    });

    expect(summary.queued).toBe(1);
    expect(summary.skipped).toBe(0);
    const row = store.get('631:20');
    expect(row.last_analysis_hash).not.toBe(oldHash);
    expect(row.updated_at).toBe(1234);
    // created_at must be preserved
    expect(row.created_at).toBe(seedTs);
  });

  it('multiple project paths: issues from both projects are processed', async () => {
    const client = {
      resolveProjectId: vi.fn(async (path) => {
        if (path === 'techcenter/reportcenter') return 631;
        if (path === 'techcenter/reportcenter_confidential') return 632;
        throw new Error(`unexpected path ${path}`);
      }),
      fetchOpenIssues: vi.fn(async (path) => {
        if (path === 'techcenter/reportcenter') {
          return [makeIssue({ iid: 1, description: 'from pub' })];
        }
        if (path === 'techcenter/reportcenter_confidential') {
          return [
            makeIssue({ iid: 5, description: 'from conf 5' }),
            makeIssue({ iid: 6, description: 'from conf 6' }),
          ];
        }
        return [];
      }),
    };

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter', 'techcenter/reportcenter_confidential'],
      logger: silentLogger(),
      now: () => 1000,
    });

    expect(summary.processed).toBe(3);
    expect(summary.queued).toBe(3);
    expect(store.get('631:1')).not.toBeNull();
    expect(store.get('632:5')).not.toBeNull();
    expect(store.get('632:6')).not.toBeNull();
    expect(client.resolveProjectId).toHaveBeenCalledTimes(2);
  });

  it('empty project: 0 open issues yields summary with zeros', async () => {
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockResolvedValue([]),
    });

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    expect(summary.processed).toBe(0);
    expect(summary.queued).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it('GitLabApiError 401: propagates (does not swallow)', async () => {
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockRejectedValue(
        new GitLabApiError('GitLab 401 Unauthorized', { status: 401, endpoint: '/x', retries: 0 }),
      ),
    });

    await expect(
      runCollect({
        stateStore: store,
        client,
        projectPaths: ['techcenter/reportcenter'],
        logger: silentLogger(),
        now: () => 1000,
      }),
    ).rejects.toMatchObject({ name: 'GitLabApiError', status: 401 });
  });

  it('GitLabApiError 5xx after retries: propagates', async () => {
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockRejectedValue(
        new GitLabApiError('GitLab 503 Service Unavailable', { status: 503, endpoint: '/x', retries: 3 }),
      ),
    });

    await expect(
      runCollect({
        stateStore: store,
        client,
        projectPaths: ['techcenter/reportcenter'],
        logger: silentLogger(),
        now: () => 1000,
      }),
    ).rejects.toMatchObject({ name: 'GitLabApiError', status: 503 });
  });

  it('issue with no labels (labels=[]) is processed normally', async () => {
    const issue = makeIssue({ iid: 42, labels: [], description: 'no-labels' });
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockResolvedValue([issue]),
    });

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    expect(summary.queued).toBe(1);
    const row = store.get('631:42');
    expect(row).not.toBeNull();
    expect(JSON.parse(row.labels)).toEqual([]);
  });

  it('issue with null/undefined description is handled (treated as empty)', async () => {
    const issue = makeIssue({ iid: 77, description: null });
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockResolvedValue([issue]),
    });

    const summary = await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    expect(summary.queued).toBe(1);
    const row = store.get('631:77');
    const expectedHash = hashIssueContent({ labels: issue.labels, description: '', state: issue.state });
    expect(row.last_analysis_hash).toBe(expectedHash);
  });

  it('caches project id per run: resolveProjectId called once per path', async () => {
    const issues = [
      makeIssue({ iid: 1, description: 'a' }),
      makeIssue({ iid: 2, description: 'b' }),
      makeIssue({ iid: 3, description: 'c' }),
    ];
    const client = makeClient({
      fetchOpenIssues: vi.fn().mockResolvedValue(issues),
    });

    await runCollect({
      stateStore: store,
      client,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    expect(client.resolveProjectId).toHaveBeenCalledTimes(1);
  });
});
