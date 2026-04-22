// Unit tests for lib/state.mjs — SQLite-backed issue state store.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A2.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, mkdtempSync, existsSync } from 'fs';
import { migrate } from '../../scripts/migrate.mjs';
import { createStateStore } from '../../lib/state.mjs';

describe('state store', () => {
  let tmp, dbPath, store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'state-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('inserts a new issue state', () => {
    const now = Math.floor(Date.now() / 1000);
    store.upsert({
      issue_uid: '631:3084',
      gitlab_url: 'https://biglab.buygta.today/techcenter/reportcenter/-/issues/3084',
      labels: ['K5', 'P1_高'],
      last_analysis_hash: 'abc123',
      status: 'open',
      created_at: now,
      updated_at: now,
    });
    const row = store.get('631:3084');
    expect(row.issue_uid).toBe('631:3084');
    expect(JSON.parse(row.labels)).toEqual(['K5', 'P1_高']);
    expect(row.status).toBe('open');
    expect(row.approval_status).toBe('pending');
    expect(row.post_failures).toBe(0);
  });

  it('updates existing row on upsert (preserves created_at)', () => {
    const t1 = 1000;
    store.upsert({
      issue_uid: 'x', gitlab_url: 'u', labels: [],
      last_analysis_hash: 'h1', status: 'open',
      created_at: t1, updated_at: t1,
    });
    store.upsert({
      issue_uid: 'x', gitlab_url: 'u', labels: [],
      last_analysis_hash: 'h2', status: 'open',
      created_at: 9999, updated_at: 2000, // created_at should NOT overwrite
    });
    const row = store.get('x');
    expect(row.last_analysis_hash).toBe('h2');
    expect(row.created_at).toBe(t1);
    expect(row.updated_at).toBe(2000);
  });

  it('returns null for missing issue', () => {
    expect(store.get('not-there')).toBeNull();
  });

  it('increments post_failures and flips status to failed at 5', () => {
    const now = Math.floor(Date.now() / 1000);
    store.upsert({
      issue_uid: 'x', gitlab_url: 'u', labels: [],
      last_analysis_hash: 'h', status: 'open',
      created_at: now, updated_at: now,
    });
    for (let i = 1; i <= 4; i++) {
      store.incrementFailure('x');
      expect(store.get('x').post_failures).toBe(i);
      expect(store.get('x').status).toBe('open');
    }
    store.incrementFailure('x');
    expect(store.get('x').post_failures).toBe(5);
    expect(store.get('x').status).toBe('failed');
  });

  it('incrementFailure on missing uid is a no-op', () => {
    // Should not throw
    expect(() => store.incrementFailure('nope')).not.toThrow();
  });

  it('lists rows by status', () => {
    const now = Math.floor(Date.now() / 1000);
    store.upsert({ issue_uid: 'a', gitlab_url: 'u', labels: [], last_analysis_hash: 'h',
      status: 'open', created_at: now, updated_at: now });
    store.upsert({ issue_uid: 'b', gitlab_url: 'u', labels: [], last_analysis_hash: 'h',
      status: 'closed', created_at: now, updated_at: now });
    store.upsert({ issue_uid: 'c', gitlab_url: 'u', labels: [], last_analysis_hash: 'h',
      status: 'open', created_at: now, updated_at: now });
    const open = store.listByStatus('open');
    expect(open.map(r => r.issue_uid).sort()).toEqual(['a', 'c']);
  });

  it('acquires and releases cron lock (exclusive)', () => {
    const handle = store.acquireCronLock();
    expect(handle).not.toBeNull();
    expect(existsSync(handle.file)).toBe(true);

    const second = store.acquireCronLock(); // should fail while held
    expect(second).toBeNull();

    store.releaseCronLock(handle);
    expect(existsSync(handle.file)).toBe(false);

    const third = store.acquireCronLock();
    expect(third).not.toBeNull();
    store.releaseCronLock(third);
  });

  it('releaseCronLock is safe to call with null handle', () => {
    expect(() => store.releaseCronLock(null)).not.toThrow();
    expect(() => store.releaseCronLock(undefined)).not.toThrow();
  });
});
