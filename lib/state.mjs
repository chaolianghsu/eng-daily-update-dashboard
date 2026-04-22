// lib/state.mjs — SQLite-backed issue state store for issue routing system.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A2.
//
// Responsibilities:
//   - upsert / get / listByStatus on issue_state table
//   - track post_failures and flip status to 'failed' at 5
//   - file-based cron lock for single-instance enforcement
//
// Not responsible for:
//   - Running migrations (scripts/migrate.mjs does that)
//   - Deciding what to hash (lib/hash.mjs)
//   - External API calls (lib/gitlab-client.mjs, lib/chat-client.mjs)

import Database from 'better-sqlite3';
import { existsSync, unlinkSync, writeFileSync } from 'fs';

const FAILURE_THRESHOLD = 5;

export function createStateStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const lockFile = `${dbPath}.cron-lock`;

  const upsertStmt = db.prepare(`
    INSERT INTO issue_state (
      issue_uid, gitlab_url, labels, thread_id, primary_msg_id,
      last_analysis_hash, last_analysis_json, last_posted_at, status,
      approval_status, approved_by, approved_at, gitlab_comment_id,
      post_failures, created_at, updated_at
    ) VALUES (
      @issue_uid, @gitlab_url, @labels, @thread_id, @primary_msg_id,
      @last_analysis_hash, @last_analysis_json, @last_posted_at, @status,
      @approval_status, @approved_by, @approved_at, @gitlab_comment_id,
      @post_failures, @created_at, @updated_at
    )
    ON CONFLICT(issue_uid) DO UPDATE SET
      gitlab_url         = excluded.gitlab_url,
      labels             = excluded.labels,
      thread_id          = COALESCE(excluded.thread_id, thread_id),
      primary_msg_id     = COALESCE(excluded.primary_msg_id, primary_msg_id),
      last_analysis_hash = excluded.last_analysis_hash,
      last_analysis_json = COALESCE(excluded.last_analysis_json, last_analysis_json),
      last_posted_at     = COALESCE(excluded.last_posted_at, last_posted_at),
      status             = excluded.status,
      approval_status    = excluded.approval_status,
      approved_by        = COALESCE(excluded.approved_by, approved_by),
      approved_at        = COALESCE(excluded.approved_at, approved_at),
      gitlab_comment_id  = COALESCE(excluded.gitlab_comment_id, gitlab_comment_id),
      post_failures      = excluded.post_failures,
      updated_at         = excluded.updated_at
      -- created_at intentionally NOT updated
  `);
  const getStmt = db.prepare('SELECT * FROM issue_state WHERE issue_uid = ?');
  const listByStatusStmt = db.prepare(
    'SELECT * FROM issue_state WHERE status = ? ORDER BY updated_at DESC'
  );
  const incrementStmt = db.prepare(`
    UPDATE issue_state
       SET post_failures = post_failures + 1,
           status = CASE WHEN post_failures + 1 >= ? THEN 'failed' ELSE status END,
           updated_at = CAST(strftime('%s', 'now') AS INTEGER)
     WHERE issue_uid = ?
  `);

  return {
    upsert(row) {
      upsertStmt.run({
        issue_uid: row.issue_uid,
        gitlab_url: row.gitlab_url,
        labels: JSON.stringify(row.labels || []),
        thread_id: row.thread_id ?? null,
        primary_msg_id: row.primary_msg_id ?? null,
        last_analysis_hash: row.last_analysis_hash,
        last_analysis_json: row.last_analysis_json ?? null,
        last_posted_at: row.last_posted_at ?? null,
        status: row.status,
        approval_status: row.approval_status ?? 'pending',
        approved_by: row.approved_by ?? null,
        approved_at: row.approved_at ?? null,
        gitlab_comment_id: row.gitlab_comment_id ?? null,
        post_failures: row.post_failures ?? 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    },

    get(uid) {
      return getStmt.get(uid) ?? null;
    },

    listByStatus(status) {
      return listByStatusStmt.all(status);
    },

    incrementFailure(uid) {
      incrementStmt.run(FAILURE_THRESHOLD, uid);
    },

    acquireCronLock() {
      try {
        // { flag: 'wx' } = fail if file exists (exclusive create)
        writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
        return { file: lockFile, pid: process.pid };
      } catch (e) {
        if (e.code === 'EEXIST') return null;
        throw e;
      }
    },

    releaseCronLock(handle) {
      if (handle && handle.file && existsSync(handle.file)) {
        unlinkSync(handle.file);
      }
    },

    close() {
      db.close();
    },
  };
}
