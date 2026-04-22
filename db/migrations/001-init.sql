-- 001-init.sql — initial schema for issue routing system
-- See docs/superpowers/plans/2026-04-22-issue-routing.md Task A1 for context.

CREATE TABLE IF NOT EXISTS issue_state (
  issue_uid          TEXT PRIMARY KEY,           -- "project_id:iid" e.g. "631:3084"
  gitlab_url         TEXT NOT NULL,
  labels             TEXT NOT NULL,              -- JSON array of label strings
  thread_id          TEXT,                       -- Google Chat thread name, NULL until first post
  primary_msg_id     TEXT,                       -- First card message name in the thread
  last_analysis_hash TEXT NOT NULL,              -- sha256 of {labels, description, state}
  last_analysis_json TEXT,                       -- Full LLM output JSON (phase1 + phase2 combined)
  last_posted_at     INTEGER,                    -- Unix epoch seconds
  status             TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed' | 'deleted' | 'failed'
  approval_status    TEXT DEFAULT 'pending',     -- 'pending' | 'approved' | 'edited' | 'dismissed'
  approved_by        TEXT,                       -- Google Chat user name (users/1234...)
  approved_at        INTEGER,
  gitlab_comment_id  TEXT,                       -- GitLab note ID after approval comment posted
  post_failures      INTEGER NOT NULL DEFAULT 0, -- Incremented on Chat API failure; >=5 → status='failed'
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_updated ON issue_state(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_approval_status ON issue_state(approval_status);

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER));
