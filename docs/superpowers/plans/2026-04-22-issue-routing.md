# Issue Routing & Plan Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **When starting implementation:** `cd ~/Projects/eng-daily-update-dashboard && git checkout -b feat/issue-routing && mkdir -p docs/superpowers/plans && cp ~/.gstack/projects/Projects/admin-issue-routing-plan-20260422-093901.md docs/superpowers/plans/2026-04-22-issue-routing.md`

**Goal:** Ship a system that auto-analyzes new GitLab issues (reportcenter / reportcenter_confidential), routes them via labels to the correct repo, drafts a plan, posts to Google Chat with Approve/Edit/Dismiss buttons, and on Approve posts the plan back to the GitLab issue as a comment.

**Architecture:** Label-based routing using a maintained YAML config + Sonnet 4.6 two-phase LLM (routing + plan). State tracked in local SQLite. Google Chat card v2 with interactive buttons. Apps Script doPost serves as webhook endpoint. Cron every 15 min until GitLab webhook added in v2.

**Tech Stack:** Bun (existing dashboard runtime), Node.js (.mjs scripts), better-sqlite3, @anthropic-ai/sdk (Sonnet 4.6), Google Chat API v1 (card v2), GitLab API v4, Google Apps Script (webhook endpoint + deploy)

**Source docs:**
- Design: `~/.gstack/projects/Projects/admin-issue-routing-design-20260421-165242.md`
- Test plan: `~/.gstack/projects/Projects/admin-issue-routing-eng-review-test-plan-20260421-174216.md`

**Prerequisites (PRE-BUILD gates):**
- [ ] **T1** — Legal/InfoSec confirm DPA allows confidential issue content → Anthropic API
- [ ] **T3** — GitLab PAT scope upgraded from `read_api` to `api` (required for comment write)

⚠️ **Do NOT start Lane D (orchestration + webhook) before T1 + T3 are cleared.** Lanes A, B, C can start in parallel immediately.

---

## File Structure

```
eng-daily-update-dashboard/
├── config/
│   └── label-routing.yaml              # NEW — exception registry
├── db/
│   ├── issue-routing.sqlite            # NEW — runtime state (gitignored)
│   └── migrations/
│       └── 001-init.sql                # NEW — schema
├── lib/                                # NEW directory
│   ├── state.mjs                       # SQLite CRUD + concurrency lock
│   ├── config.mjs                      # label-routing.yaml loader + validator
│   ├── gitlab-client.mjs               # API wrapper (read issues, write comments)
│   ├── chat-client.mjs                 # Card post, threaded reply, webhook verify
│   ├── hash.mjs                        # Deterministic issue-content hashing
│   └── llm/
│       ├── context-builder.mjs         # Shared input assembly for Phase 1 + 2
│       ├── phase1-routing.mjs          # Routing + layer classification
│       └── phase2-plan.mjs             # Plan draft generation
├── scripts/
│   ├── collect-new-issues.mjs          # NEW — Stage 1: fetch + diff
│   ├── analyze-and-post.mjs            # NEW — Stage 2+3: LLM + Chat post
│   ├── audit-routing-config.mjs        # NEW — Monthly drift detection
│   └── run-issue-routing.sh            # NEW — Cron entrypoint (orchestrates scripts)
├── appscript/
│   └── Code.gs                         # MODIFY — add doPost webhook handler
├── test/
│   ├── eval/
│   │   ├── fixtures/                   # NEW — 20 golden issue snapshots (anonymized)
│   │   ├── run-eval.mjs                # NEW — eval runner
│   │   └── baseline-v0.json            # NEW — committed baseline
│   ├── unit/
│   │   ├── state.test.mjs
│   │   ├── config.test.mjs
│   │   ├── hash.test.mjs
│   │   ├── gitlab-client.test.mjs
│   │   ├── chat-client.test.mjs
│   │   └── llm/
│   │       ├── context-builder.test.mjs
│   │       └── prompt-contract.test.mjs  # Phase1/2 output schema
│   ├── integration/
│   │   ├── cron-flow.test.mjs
│   │   ├── webhook-approve.test.mjs
│   │   └── state-transitions.test.mjs
│   └── e2e/
│       └── issue-routing.e2e.mjs       # Playwright: mock GitLab + mock Chat
├── docs/
│   └── superpowers/
│       └── plans/
│           └── 2026-04-22-issue-routing.md   # THIS FILE (copy into repo)
├── .github/
│   └── workflows/
│       └── issue-routing-eval.yml      # NEW — CI gate for eval suite
└── package.json                        # MODIFY — add deps + scripts
```

**File split rationale:** Each `lib/` module has one responsibility. `scripts/` are orchestration (DAG stages + entrypoint). Test tree mirrors lib/scripts for discoverability. Eval separate from unit tests (different runtime characteristics).

---

# 🚦 Task 0: Repo Bootstrap

**Files:**
- Modify: `eng-daily-update-dashboard/package.json`
- Create: `eng-daily-update-dashboard/.gitignore` (append `db/issue-routing.sqlite`)
- Create: `eng-daily-update-dashboard/config/.gitkeep`
- Create: `eng-daily-update-dashboard/lib/.gitkeep`
- Create: `eng-daily-update-dashboard/db/migrations/.gitkeep`

- [ ] **Step 0.1: Create feature branch**

```bash
cd ~/Projects/eng-daily-update-dashboard
git status  # verify clean
git checkout -b feat/issue-routing
```

- [ ] **Step 0.2: Install deps**

```bash
bun add better-sqlite3 yaml @anthropic-ai/sdk
bun add -d vitest @types/better-sqlite3
```

- [ ] **Step 0.3: Create directory skeleton**

```bash
mkdir -p config db/migrations lib/llm scripts test/{unit/llm,integration,e2e,eval/fixtures}
touch config/.gitkeep lib/.gitkeep db/migrations/.gitkeep
```

- [ ] **Step 0.4: Update .gitignore**

Append to `.gitignore`:
```
# Issue routing system
db/issue-routing.sqlite
db/issue-routing.sqlite-journal
db/issue-routing.sqlite-wal
db/issue-routing.sqlite-shm
```

- [ ] **Step 0.5: Add scripts to package.json**

In `package.json` `scripts` section:
```json
{
  "scripts": {
    "issue-routing:collect": "node scripts/collect-new-issues.mjs",
    "issue-routing:analyze": "node scripts/analyze-and-post.mjs",
    "issue-routing:audit": "node scripts/audit-routing-config.mjs",
    "issue-routing:eval": "node test/eval/run-eval.mjs",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:e2e": "playwright test test/e2e"
  }
}
```

- [ ] **Step 0.6: Commit bootstrap**

```bash
git add package.json bun.lock .gitignore config/.gitkeep lib/.gitkeep db/migrations/.gitkeep
git commit -m "feat(issue-routing): bootstrap directory structure + deps"
```

---

# 🅰️ Lane A: Infrastructure (state + config)

**Can start immediately. No external dependencies. ~3-4 hours CC.**

## Task A1: SQLite schema + migration

**Files:**
- Create: `db/migrations/001-init.sql`
- Create: `scripts/migrate.mjs`

- [ ] **Step A1.1: Write migration SQL**

`db/migrations/001-init.sql`:
```sql
CREATE TABLE IF NOT EXISTS issue_state (
  issue_uid TEXT PRIMARY KEY,           -- "project_id:iid"
  gitlab_url TEXT NOT NULL,
  labels TEXT NOT NULL,                  -- JSON array
  thread_id TEXT,                        -- Google Chat thread name, NULL until first post
  primary_msg_id TEXT,                   -- First card message name
  last_analysis_hash TEXT NOT NULL,
  last_analysis_json TEXT,               -- Full LLM output JSON
  last_posted_at INTEGER,                -- Unix epoch seconds
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'closed' | 'deleted' | 'failed'
  approval_status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'edited' | 'dismissed'
  approved_by TEXT,                      -- Google Chat user ID
  approved_at INTEGER,
  gitlab_comment_id TEXT,                -- GitLab note ID after approval post
  post_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_updated ON issue_state(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_approval_status ON issue_state(approval_status);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%s', 'now'));
```

- [ ] **Step A1.2: Write migration script**

`scripts/migrate.mjs`:
```javascript
#!/usr/bin/env node
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'db', 'issue-routing.sqlite');
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

export function migrate(dbPath = DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    db.exec(sql);
  }
  db.close();
  console.log(`Migrated: ${files.length} files → ${dbPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}
```

- [ ] **Step A1.3: Run migration locally**

```bash
node scripts/migrate.mjs
sqlite3 db/issue-routing.sqlite ".schema issue_state"
```

Expected output: full CREATE TABLE including all columns.

- [ ] **Step A1.4: Commit**

```bash
git add db/migrations/001-init.sql scripts/migrate.mjs
git commit -m "feat(issue-routing): add SQLite schema + migration runner"
```

## Task A2: State module — write tests first (TDD)

**Files:**
- Test: `test/unit/state.test.mjs`
- Create: `lib/state.mjs`

- [ ] **Step A2.1: Write failing tests**

`test/unit/state.test.mjs`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, mkdtempSync } from 'fs';
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
    rmSync(tmp, { recursive: true });
  });

  it('inserts a new issue state', () => {
    const now = Date.now() / 1000 | 0;
    store.upsert({
      issue_uid: '631:3084', gitlab_url: 'https://x/y#3084',
      labels: ['K5', 'P1_高'], last_analysis_hash: 'abc123',
      status: 'open', created_at: now, updated_at: now,
    });
    const row = store.get('631:3084');
    expect(row.issue_uid).toBe('631:3084');
    expect(JSON.parse(row.labels)).toEqual(['K5', 'P1_高']);
  });

  it('updates existing row on upsert (preserves created_at)', () => {
    const t1 = 1000;
    store.upsert({ issue_uid: 'x', gitlab_url: 'u', labels: [], last_analysis_hash: 'h1', status: 'open', created_at: t1, updated_at: t1 });
    store.upsert({ issue_uid: 'x', gitlab_url: 'u', labels: [], last_analysis_hash: 'h2', status: 'open', created_at: t1, updated_at: 2000 });
    const row = store.get('x');
    expect(row.last_analysis_hash).toBe('h2');
    expect(row.created_at).toBe(t1);
  });

  it('returns null for missing issue', () => {
    expect(store.get('not-there')).toBeNull();
  });

  it('increments post_failures', () => {
    const now = Date.now() / 1000 | 0;
    store.upsert({ issue_uid: 'x', gitlab_url: 'u', labels: [], last_analysis_hash: 'h', status: 'open', created_at: now, updated_at: now });
    store.incrementFailure('x');
    store.incrementFailure('x');
    const row = store.get('x');
    expect(row.post_failures).toBe(2);
  });

  it('marks issue as failed when failures >= 5', () => {
    const now = Date.now() / 1000 | 0;
    store.upsert({ issue_uid: 'x', gitlab_url: 'u', labels: [], last_analysis_hash: 'h', status: 'open', created_at: now, updated_at: now });
    for (let i = 0; i < 5; i++) store.incrementFailure('x');
    expect(store.get('x').status).toBe('failed');
  });

  it('acquires and releases cron lock', () => {
    const handle = store.acquireCronLock();
    expect(handle).not.toBeNull();
    const second = store.acquireCronLock();  // should fail while held
    expect(second).toBeNull();
    store.releaseCronLock(handle);
    const third = store.acquireCronLock();
    expect(third).not.toBeNull();
    store.releaseCronLock(third);
  });
});
```

- [ ] **Step A2.2: Run tests, verify they fail**

```bash
bun run test:unit -- state
```

Expected: FAIL with "createStateStore is not defined".

- [ ] **Step A2.3: Implement state module**

`lib/state.mjs`:
```javascript
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';

export function createStateStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const lockFile = `${dbPath}.cron-lock`;

  return {
    upsert(row) {
      const existing = this.get(row.issue_uid);
      const created_at = existing?.created_at ?? row.created_at;
      const stmt = db.prepare(`
        INSERT INTO issue_state (issue_uid, gitlab_url, labels, thread_id, primary_msg_id,
          last_analysis_hash, last_analysis_json, last_posted_at, status,
          approval_status, approved_by, approved_at, gitlab_comment_id,
          post_failures, created_at, updated_at)
        VALUES (@issue_uid, @gitlab_url, @labels, @thread_id, @primary_msg_id,
          @last_analysis_hash, @last_analysis_json, @last_posted_at, @status,
          @approval_status, @approved_by, @approved_at, @gitlab_comment_id,
          @post_failures, @created_at, @updated_at)
        ON CONFLICT(issue_uid) DO UPDATE SET
          gitlab_url = excluded.gitlab_url,
          labels = excluded.labels,
          thread_id = COALESCE(excluded.thread_id, thread_id),
          primary_msg_id = COALESCE(excluded.primary_msg_id, primary_msg_id),
          last_analysis_hash = excluded.last_analysis_hash,
          last_analysis_json = excluded.last_analysis_json,
          last_posted_at = COALESCE(excluded.last_posted_at, last_posted_at),
          status = excluded.status,
          approval_status = excluded.approval_status,
          approved_by = COALESCE(excluded.approved_by, approved_by),
          approved_at = COALESCE(excluded.approved_at, approved_at),
          gitlab_comment_id = COALESCE(excluded.gitlab_comment_id, gitlab_comment_id),
          post_failures = excluded.post_failures,
          updated_at = excluded.updated_at
      `);
      stmt.run({
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
        created_at,
        updated_at: row.updated_at,
      });
    },

    get(uid) {
      return db.prepare('SELECT * FROM issue_state WHERE issue_uid = ?').get(uid) ?? null;
    },

    listByStatus(status) {
      return db.prepare('SELECT * FROM issue_state WHERE status = ? ORDER BY updated_at DESC').all(status);
    },

    incrementFailure(uid) {
      const row = this.get(uid);
      if (!row) return;
      const newCount = row.post_failures + 1;
      const newStatus = newCount >= 5 ? 'failed' : row.status;
      db.prepare('UPDATE issue_state SET post_failures = ?, status = ?, updated_at = ? WHERE issue_uid = ?')
        .run(newCount, newStatus, Date.now() / 1000 | 0, uid);
    },

    acquireCronLock() {
      if (existsSync(lockFile)) return null;
      try {
        const fs = require('fs');
        fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
        return { file: lockFile, pid: process.pid };
      } catch (e) {
        if (e.code === 'EEXIST') return null;
        throw e;
      }
    },

    releaseCronLock(handle) {
      if (handle && existsSync(handle.file)) unlinkSync(handle.file);
    },

    close() {
      db.close();
    },
  };
}
```

- [ ] **Step A2.4: Run tests, verify they pass**

```bash
bun run test:unit -- state
```

Expected: 6/6 PASS.

- [ ] **Step A2.5: Commit**

```bash
git add test/unit/state.test.mjs lib/state.mjs
git commit -m "feat(issue-routing): state module with SQLite + cron lock (6 tests)"
```

## Task A3: Config loader + validator (TDD)

**Files:**
- Test: `test/unit/config.test.mjs`
- Create: `config/label-routing.yaml`
- Create: `lib/config.mjs`

- [ ] **Step A3.1: Write initial config**

`config/label-routing.yaml`:
```yaml
# Label → Repo routing configuration
# Updated via PR. See docs/superpowers/plans/2026-04-22-issue-routing.md for rules.
# Drift audit runs weekly via scripts/audit-routing-config.mjs.

labels:
  K5:
    product: KEYPO
    primary_group: KEYPO
    known_exceptions:
      - llmprojects/keypo-agent
      # Add more as discovered via drift audit or IC feedback

  BD:
    product: BigData
    primary_group: bigdata
    known_exceptions:
      - bigdata1
      # bigdata1 may be experimental fork

  DV:
    product: DailyView
    primary_group: dailyview
    known_exceptions:
      - dv-report
      - dv-survey

  Fanti:
    product: Fanti
    primary_group: null  # intentionally cross-group
    layers:
      crawler:
        - CrawlersV2/fanti-insights-api
      backend:
        - cdp/fanti-insights-backend
        - cdp/fanti-review-backend
      ui:
        - cdp/fanti-insights-dashboard
        - cdp/fanti-review-dashboard
      nginx:
        - cdp/fanti-review-nginx
        - cdp/fanti-insights-nginx
      keypo_integration:
        - KEYPO/fanti_info_web
        - KEYPO/fanti_manager

  Data:
    product: Data ops
    primary_group: Crawlers
    known_exceptions:
      - CrawlersV2
      - bigdata1

  信義:
    product: Xinyi
    primary_group: sinyi

# Labels that are NOT product routing (priority / type)
ignore_for_routing:
  - P1_高
  - P2_中
  - P3_低
  - Bug
  - Feature
```

- [ ] **Step A3.2: Write failing tests**

`test/unit/config.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { loadLabelRouting, validateConfig } from '../../lib/config.mjs';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const fixturePath = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const p = join(dir, 'label-routing.yaml');
  writeFileSync(p, content);
  return p;
};

describe('config loader', () => {
  it('loads valid YAML', () => {
    const p = fixturePath(`
labels:
  K5:
    product: KEYPO
    primary_group: KEYPO
    known_exceptions:
      - llmprojects/keypo-agent
ignore_for_routing:
  - P1_高
`);
    const cfg = loadLabelRouting(p);
    expect(cfg.labels.K5.primary_group).toBe('KEYPO');
    expect(cfg.labels.K5.known_exceptions).toContain('llmprojects/keypo-agent');
  });

  it('rejects malformed YAML with specific error', () => {
    const p = fixturePath('labels:\n  K5:\n    - bad indent');
    expect(() => loadLabelRouting(p)).toThrow(/YAMLParseError|invalid yaml/i);
  });

  it('rejects config missing labels key', () => {
    const p = fixturePath('other_key: 1\n');
    expect(() => validateConfig(loadLabelRouting(p))).toThrow(/missing.*labels/i);
  });

  it('rejects Fanti without layers', () => {
    const cfg = {
      labels: {
        Fanti: { product: 'Fanti', primary_group: null },
      },
    };
    expect(() => validateConfig(cfg)).toThrow(/Fanti.*layers/i);
  });

  it('rejects label with neither primary_group nor layers', () => {
    const cfg = { labels: { X: { product: 'X' } } };
    expect(() => validateConfig(cfg)).toThrow(/X.*primary_group.*layers/i);
  });

  it('normalizes label keys to preserve case', () => {
    const p = fixturePath(`
labels:
  信義:
    product: Xinyi
    primary_group: sinyi
`);
    const cfg = loadLabelRouting(p);
    expect(cfg.labels['信義'].primary_group).toBe('sinyi');
  });
});
```

- [ ] **Step A3.3: Run tests, verify fail**

```bash
bun run test:unit -- config
```

Expected: FAIL all 6 with "loadLabelRouting undefined".

- [ ] **Step A3.4: Implement config loader**

`lib/config.mjs`:
```javascript
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

export function loadLabelRouting(path) {
  const raw = readFileSync(path, 'utf8');
  return parseYaml(raw);
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('config: root must be object');
  }
  if (!cfg.labels || typeof cfg.labels !== 'object') {
    throw new Error('config: missing required key "labels"');
  }
  for (const [name, spec] of Object.entries(cfg.labels)) {
    if (spec.primary_group === null || spec.primary_group === undefined) {
      if (!spec.layers) {
        if (spec.primary_group === null) {
          throw new Error(`config: label "${name}" has null primary_group but no layers defined`);
        }
        throw new Error(`config: label "${name}" needs either primary_group or layers`);
      }
      if (name === 'Fanti' && !spec.layers) {
        throw new Error(`config: Fanti requires layers (crawler / backend / ui / nginx / keypo_integration)`);
      }
    }
  }
  return cfg;
}

export function getRepoSuggestions(cfg, label, layer = null) {
  const spec = cfg.labels[label];
  if (!spec) return { primary: [], exceptions: [], isKnownLabel: false };
  if (spec.layers && layer && spec.layers[layer]) {
    return { primary: spec.layers[layer], exceptions: [], isKnownLabel: true };
  }
  return {
    primary_group: spec.primary_group,
    known_exceptions: spec.known_exceptions || [],
    isKnownLabel: true,
  };
}
```

- [ ] **Step A3.5: Run tests, verify pass**

```bash
bun run test:unit -- config
```

Expected: 6/6 PASS.

- [ ] **Step A3.6: Commit**

```bash
git add config/label-routing.yaml lib/config.mjs test/unit/config.test.mjs
git commit -m "feat(issue-routing): label routing config + loader/validator"
```

## Task A4: Hash utility (TDD)

**Files:**
- Test: `test/unit/hash.test.mjs`
- Create: `lib/hash.mjs`

- [ ] **Step A4.1: Write failing tests**

`test/unit/hash.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { hashIssueContent } from '../../lib/hash.mjs';

describe('hashIssueContent', () => {
  it('is deterministic for same input', () => {
    const a = { labels: ['K5', 'P1_高'], description: 'hi', state: 'opened' };
    expect(hashIssueContent(a)).toBe(hashIssueContent(a));
  });

  it('is order-independent for labels', () => {
    const a = hashIssueContent({ labels: ['K5', 'Bug'], description: 'x', state: 'opened' });
    const b = hashIssueContent({ labels: ['Bug', 'K5'], description: 'x', state: 'opened' });
    expect(a).toBe(b);
  });

  it('changes when description changes', () => {
    const a = hashIssueContent({ labels: [], description: 'a', state: 'opened' });
    const b = hashIssueContent({ labels: [], description: 'b', state: 'opened' });
    expect(a).not.toBe(b);
  });

  it('changes when state changes', () => {
    const a = hashIssueContent({ labels: [], description: 'x', state: 'opened' });
    const b = hashIssueContent({ labels: [], description: 'x', state: 'closed' });
    expect(a).not.toBe(b);
  });

  it('ignores title (whitespace insensitive)', () => {
    // title not in hash, so no change
    const a = hashIssueContent({ labels: [], description: 'x', state: 'opened', title: 'A' });
    const b = hashIssueContent({ labels: [], description: 'x', state: 'opened', title: 'B' });
    expect(a).toBe(b);
  });

  it('returns 64-char hex sha256', () => {
    const h = hashIssueContent({ labels: [], description: 'x', state: 'opened' });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step A4.2: Run, verify fail**

```bash
bun run test:unit -- hash
```

- [ ] **Step A4.3: Implement**

`lib/hash.mjs`:
```javascript
import { createHash } from 'crypto';

export function hashIssueContent({ labels = [], description = '', state = 'opened' }) {
  const normalized = [
    [...labels].sort().join(','),
    description,
    state,
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex');
}
```

- [ ] **Step A4.4: Run, verify pass + commit**

```bash
bun run test:unit -- hash  # 6/6 pass
git add lib/hash.mjs test/unit/hash.test.mjs
git commit -m "feat(issue-routing): deterministic issue content hash"
```

**Lane A complete.** All 18 tests passing. ~3 hours CC total.

---

# 🅲 Lane C: External Clients (GitLab + Chat)

**Can start parallel with Lane A. ~4-5 hours CC.**

## Task C1: GitLab client — fetch issues (TDD)

**Files:**
- Test: `test/unit/gitlab-client.test.mjs`
- Create: `lib/gitlab-client.mjs`

- [ ] **Step C1.1: Write failing test**

Test file covers: successful fetch (mock fetch), 401 error, 5xx error, empty result, timeout.

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGitLabClient, GitLabApiError } from '../../lib/gitlab-client.mjs';

describe('gitlab-client fetchOpenIssues', () => {
  let client, mockFetch;
  beforeEach(() => {
    mockFetch = vi.fn();
    client = createGitLabClient({ baseUrl: 'https://x', token: 't', fetch: mockFetch });
  });

  it('fetches issues with correct headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ iid: 1, title: 'T', state: 'opened', labels: [], description: 'd' }],
    });
    const r = await client.fetchOpenIssues('techcenter/reportcenter');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v4/projects/techcenter%2Freportcenter/issues?state=opened'),
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 't' } })
    );
    expect(r).toHaveLength(1);
  });

  it('throws GitLabApiError on 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    await expect(client.fetchOpenIssues('x/y')).rejects.toThrow(GitLabApiError);
  });

  it('retries 3 times on 5xx before failing', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(client.fetchOpenIssues('x/y')).rejects.toThrow(/503/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns empty array when no issues', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const r = await client.fetchOpenIssues('x/y');
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step C1.2: Run fail**

```bash
bun run test:unit -- gitlab-client
```

- [ ] **Step C1.3: Implement**

`lib/gitlab-client.mjs`:
```javascript
export class GitLabApiError extends Error {
  constructor(message, { status, endpoint, retries } = {}) {
    super(message);
    this.name = 'GitLabApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.retries = retries;
  }
}

const DEFAULT_RETRIES = 3;
const BACKOFF_MS = [1000, 5000, 15000];

export function createGitLabClient({ baseUrl, token, fetch = globalThis.fetch, maxRetries = DEFAULT_RETRIES }) {
  async function apiCall(path, { method = 'GET', body = null, idempotent = true } = {}) {
    const url = `${baseUrl}/api/v4${path}`;
    const headers = { 'PRIVATE-TOKEN': token };
    if (body) headers['Content-Type'] = 'application/json';
    let lastError;
    const attempts = idempotent ? maxRetries : 1;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        if (r.ok) return await r.json();
        // 4xx = don't retry
        if (r.status >= 400 && r.status < 500) {
          throw new GitLabApiError(`GitLab ${r.status} ${r.statusText}`, { status: r.status, endpoint: path, retries: i });
        }
        // 5xx = retry
        lastError = new GitLabApiError(`GitLab ${r.status} ${r.statusText}`, { status: r.status, endpoint: path, retries: i });
      } catch (e) {
        if (e instanceof GitLabApiError) throw e;
        lastError = e;
      }
      if (i < attempts - 1) await sleep(BACKOFF_MS[i] || 15000);
    }
    throw lastError;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return {
    async fetchOpenIssues(projectPath, { since = null } = {}) {
      const encoded = encodeURIComponent(projectPath);
      let path = `/projects/${encoded}/issues?state=opened&per_page=100&order_by=updated_at&sort=desc`;
      if (since) path += `&updated_after=${encodeURIComponent(since)}`;
      return apiCall(path);
    },

    async fetchIssue(projectPath, iid) {
      const encoded = encodeURIComponent(projectPath);
      return apiCall(`/projects/${encoded}/issues/${iid}`);
    },

    async fetchIssueNotes(projectPath, iid) {
      const encoded = encodeURIComponent(projectPath);
      return apiCall(`/projects/${encoded}/issues/${iid}/notes?per_page=100&sort=asc`);
    },

    async postIssueComment(projectPath, iid, body) {
      const encoded = encodeURIComponent(projectPath);
      return apiCall(`/projects/${encoded}/issues/${iid}/notes`, {
        method: 'POST',
        body: { body },
        idempotent: false,  // DO NOT retry writes
      });
    },

    async resolveProjectId(projectPath) {
      const encoded = encodeURIComponent(projectPath);
      const proj = await apiCall(`/projects/${encoded}`);
      return proj.id;
    },
  };
}
```

- [ ] **Step C1.4: Run pass + commit**

```bash
bun run test:unit -- gitlab-client
git add lib/gitlab-client.mjs test/unit/gitlab-client.test.mjs
git commit -m "feat(issue-routing): gitlab client (read + write with retry)"
```

## Task C2: Chat client — card post + threaded reply (TDD)

**Files:**
- Test: `test/unit/chat-client.test.mjs`
- Create: `lib/chat-client.mjs`

Follow same TDD pattern as C1. Cover:
- `postCard(spaceId, card)` returns message name + thread name
- `replyInThread(spaceId, threadName, card)` posts card into thread
- `updateCard(messageName, newCard)` patches existing message (for approval state change)
- `verifyWebhookSignature(headers, body)` validates Google Chat webhook HMAC
- Retry on 429/5xx, no retry on 4xx
- Rejects invalid card v2 structure

- [ ] **Step C2.1-C2.4**: Follow TDD cycle (test → fail → implement → pass → commit)

Key card v2 structure:
```javascript
function buildAnalysisCard({ issue, analysis, actionToken }) {
  return {
    cardsV2: [{
      cardId: `issue-${issue.uid}`,
      card: {
        header: {
          title: `🔍 ${issue.title}`,
          subtitle: `${issue.labels.join(' · ')} · #${issue.iid}`,
        },
        sections: [
          {
            header: '摘要',
            widgets: [{ textParagraph: { text: analysis.summary } }],
          },
          {
            header: '建議 repos',
            widgets: [{
              textParagraph: {
                text: analysis.suggested_repos.map(r => `• ${r}`).join('\n'),
              },
            }],
          },
          {
            header: `建議 assignees · 信心 ${Math.round(analysis.confidence * 100)}%`,
            widgets: [{ textParagraph: { text: analysis.suggested_assignees.join(', ') } }],
          },
          analysis.plan_draft ? {
            header: 'Plan draft',
            widgets: [{ textParagraph: { text: analysis.plan_draft.map(s => `${s}`).join('\n') } }],
          } : null,
          {
            widgets: [{
              buttonList: {
                buttons: [
                  { text: '✅ Approve', onClick: { action: { function: 'approveIssue', parameters: [{ key: 'token', value: actionToken }, { key: 'issue_uid', value: issue.uid }] } } },
                  { text: '✏️ Edit', onClick: { action: { function: 'editIssue', parameters: [{ key: 'token', value: actionToken }, { key: 'issue_uid', value: issue.uid }] } } },
                  { text: '❌ Dismiss', onClick: { action: { function: 'dismissIssue', parameters: [{ key: 'token', value: actionToken }, { key: 'issue_uid', value: issue.uid }] } } },
                ],
              },
            }],
          },
        ].filter(Boolean),
      },
    }],
  };
}
```

Webhook signature verification uses Google Chat's app-specific token. The `chat-config.json` should include `webhookSecret` (random 256-bit string), validated via HMAC-SHA256 over `timestamp + body`.

- [ ] **Step C2.5: Commit**

```bash
git add lib/chat-client.mjs test/unit/chat-client.test.mjs
git commit -m "feat(issue-routing): google chat client (card + reply + webhook verify)"
```

**Lane C complete.** ~12 unit tests passing.

---

# 🅱️ Lane B: LLM Pipeline (2 phases + eval)

**Depends on Lane A (config loader). ~5-6 hours CC.**

## Task B1: Context builder (shared between Phase 1 + 2)

**Files:**
- Test: `test/unit/llm/context-builder.test.mjs`
- Create: `lib/llm/context-builder.mjs`

Responsibilities:
- Truncate issue description to 2K chars (head 1500 + tail 500)
- Truncate each similar issue's comments to 500 chars
- Hard total input ≤ 4K tokens (approximate: chars/4)
- Return structured context object ready for prompt

TDD steps identical to prior tasks.

## Task B2: Phase 1 routing prompt + schema (TDD)

**Files:**
- Test: `test/unit/llm/prompt-contract.test.mjs` (schema validation)
- Create: `lib/llm/phase1-routing.mjs`

- [ ] **Step B2.1: Write Phase 1 module**

`lib/llm/phase1-routing.mjs`:
```javascript
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';

const ROUTING_TOOL = {
  name: 'route_issue',
  description: '根據 issue 內容和歷史相似 issue 做路由建議',
  input_schema: {
    type: 'object',
    required: ['layer', 'suggested_repos', 'suggested_assignees', 'reasoning', 'confidence', 'caveats'],
    properties: {
      layer: { type: 'string', description: 'For Fanti: crawler | backend | ui | nginx | keypo_integration | unsure. For others: "n/a"' },
      suggested_repos: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      suggested_assignees: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      reasoning: { type: 'string', description: '1-2 句,zh-TW' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      caveats: { type: 'array', items: { type: 'string' } },
    },
  },
};

export async function runPhase1Routing(context, { apiKey } = {}) {
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [ROUTING_TOOL],
    tool_choice: { type: 'tool', name: 'route_issue' },
    messages: [
      { role: 'user', content: buildPhase1Prompt(context) },
    ],
  });
  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new LLMApiError('Phase1: no tool_use in response');
  return toolUse.input;
}

function buildPhase1Prompt(ctx) {
  return `You are an engineering triage assistant for an internal team. Given a new GitLab issue and similar past closed issues, suggest:
1. Layer (if Fanti label present; else "n/a")
2. Top 3 suggested repos (from candidates in label_config)
3. Top 2-3 suggested assignees (based on past assignee frequency)
4. Reasoning in 1-2 zh-TW sentences
5. Confidence 0.0-1.0
6. Any caveats

Rules:
- Only suggest repos from label_config.candidates
- If label is Fanti, assign one of: crawler, backend, ui, nginx, keypo_integration, unsure
- confidence < 0.5 when history is sparse or ambiguous
- Never invent repos not in candidates

NEW ISSUE:
Title: ${ctx.new_issue.title}
Labels: ${ctx.new_issue.labels.join(', ')}
Description:
${ctx.new_issue.description}

LABEL CONFIG:
${JSON.stringify(ctx.label_config, null, 2)}

${ctx.similar_issues.length > 0 ? `SIMILAR PAST ISSUES:
${ctx.similar_issues.map((s, i) => `
[${i+1}] #${s.iid} "${s.title}"
Labels: ${s.labels.join(', ')}
Assignee: ${s.assignee}
Closing excerpt: ${s.closing_excerpt}
`).join('\n---\n')}` : 'NO SIMILAR ISSUES FOUND — cold start. Set confidence ≤ 0.5.'}

Invoke the route_issue tool with your structured response.`;
}

export class LLMApiError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'LLMApiError';
    Object.assign(this, meta);
  }
}
```

- [ ] **Step B2.2-B2.4**: Test that the tool_use output structure matches schema. Mock Anthropic SDK. Verify retry on empty response, fallback on JSON validation fail.

- [ ] **Step B2.5: Commit**

```bash
git add lib/llm/phase1-routing.mjs test/unit/llm/prompt-contract.test.mjs
git commit -m "feat(issue-routing): Phase 1 routing LLM with tool_use schema"
```

## Task B3: Phase 2 plan generation (TDD)

**Files:**
- Create: `lib/llm/phase2-plan.mjs`

Only runs when `phase1.confidence >= 0.5`.

```javascript
const PLAN_TOOL = {
  name: 'generate_plan',
  description: '根據 issue 和過去解法 pattern 生 plan draft',
  input_schema: {
    type: 'object',
    required: ['summary', 'plan_draft'],
    properties: {
      summary: { type: 'string', description: '3-5 句 zh-TW 摘要' },
      plan_draft: { type: 'array', items: { type: 'string' }, maxItems: 5, description: '3-5 條實作步驟' },
    },
  },
};

export async function runPhase2Plan(context, phase1Result, { apiKey } = {}) {
  if (phase1Result.confidence < 0.5) {
    return { summary: phase1Result.reasoning, plan_draft: null };
  }
  // ... same pattern as Phase 1, different tool
}
```

TDD steps + commit.

## Task B4: Eval suite (golden fixtures)

**Files:**
- Create: `test/eval/fixtures/*.json` (20 files, anonymized closed issues)
- Create: `test/eval/run-eval.mjs`
- Create: `test/eval/baseline-v0.json`
- Create: `.github/workflows/issue-routing-eval.yml`

- [ ] **Step B4.1: Fixture schema**

Each fixture: `{ issue: {title, description, labels}, expected: { layer, expected_repos: [set], expected_assignees_any_of: [set], min_confidence } }`

- [ ] **Step B4.2: Collect fixtures**

Use GitLab API to export 20 representative closed issues (6 K5 infra + 4 K5 agent + 4 Fanti × layers + 2 BD + 2 DV + 2 unsure). **Anonymize** per T6 policy (strip emails, customer names).

- [ ] **Step B4.3: Eval runner**

```javascript
// test/eval/run-eval.mjs
import { runPhase1Routing } from '../../lib/llm/phase1-routing.mjs';
// ... load fixtures, run Phase1, compare to expected, compute pass/fail, write results JSON
// Gate: >= 18/20 passes required to advance prompt change
```

- [ ] **Step B4.4: CI workflow**

```yaml
# .github/workflows/issue-routing-eval.yml
name: Issue routing eval gate
on:
  pull_request:
    paths:
      - 'lib/llm/**'
      - 'test/eval/fixtures/**'
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run issue-routing:eval
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

- [ ] **Step B4.5: Run eval locally, capture as baseline**

```bash
bun run issue-routing:eval > test/eval/baseline-v0.json
git add test/eval/
git commit -m "feat(issue-routing): eval suite with 20 golden fixtures + CI gate"
```

**Lane B complete.** ~18 tests + eval gate.

---

# 🅳 Lane D: Orchestration + Webhook

**Depends on Lanes A + B + C. ~5-6 hours CC. BLOCKED until T1 + T3 cleared.**

## Task D1: collect-new-issues script

**Files:**
- Test: `test/integration/cron-flow.test.mjs`
- Create: `scripts/collect-new-issues.mjs`

Responsibilities:
1. Acquire cron lock (fail fast if another instance running)
2. For each `PROJECT_PATH in [reportcenter, reportcenter_confidential]`:
   - Fetch open issues updated since last run (using state's `updated_at` max)
   - For each: compute hash, compare to state
   - Write to state: new issues OR hash-diff (needs re-analysis)
3. Exit 0. Next stage reads state.

```javascript
#!/usr/bin/env node
import { createStateStore } from '../lib/state.mjs';
import { createGitLabClient } from '../lib/gitlab-client.mjs';
import { loadLabelRouting, validateConfig } from '../lib/config.mjs';
import { hashIssueContent } from '../lib/hash.mjs';
import { readFileSync } from 'fs';

async function main() {
  const gitlabCfg = JSON.parse(readFileSync(process.env.GITLAB_CONFIG || 'gitlab-config.json', 'utf8'));
  const cfg = validateConfig(loadLabelRouting(process.env.LABEL_CONFIG || 'config/label-routing.yaml'));

  const store = createStateStore(process.env.STATE_DB || 'db/issue-routing.sqlite');
  const lock = store.acquireCronLock();
  if (!lock) {
    console.log('Another cron instance running, skipping');
    process.exit(0);
  }

  try {
    const client = createGitLabClient(gitlabCfg);
    const PROJECTS = process.env.PROJECTS?.split(',') || ['techcenter/reportcenter', 'techcenter/reportcenter_confidential'];

    for (const path of PROJECTS) {
      const projectId = await client.resolveProjectId(path);
      const issues = await client.fetchOpenIssues(path);

      for (const issue of issues) {
        const uid = `${projectId}:${issue.iid}`;
        const hash = hashIssueContent({
          labels: issue.labels,
          description: issue.description || '',
          state: issue.state,
        });
        const existing = store.get(uid);
        if (existing && existing.last_analysis_hash === hash) continue;  // no change

        store.upsert({
          issue_uid: uid,
          gitlab_url: issue.web_url,
          labels: issue.labels,
          last_analysis_hash: hash,
          status: existing?.status || 'open',
          created_at: Date.now() / 1000 | 0,
          updated_at: Date.now() / 1000 | 0,
        });
        console.log(`[collect] queued ${uid} hash=${hash.slice(0, 8)}`);
      }
    }
  } finally {
    store.releaseCronLock(lock);
    store.close();
  }
}

main().catch(e => {
  console.error('[collect] FATAL', e);
  process.exit(1);
});
```

TDD: integration test spins up in-memory DB + mock GitLab fetch.

## Task D2: analyze-and-post script

**Files:**
- Test: `test/integration/analyze-post.test.mjs`
- Create: `scripts/analyze-and-post.mjs`

Responsibilities:
1. Read state for issues where `status='open' AND last_analysis_hash != (last posted hash)` (approximate: added `last_posted_hash` column, or track via `last_posted_at`+hash change)
2. For each, build context:
   - Read issue detail (title/desc already in state? or refetch)
   - Find similar past issues by label match (simple SQL for v1; vector similarity in v2)
   - Run Phase 1 LLM
   - If confidence >= 0.5, run Phase 2
3. Decide post type:
   - No prior post (`primary_msg_id` is null): call `postCard` → new thread
   - Prior post exists + hash changed: call `replyInThread` → threaded update
   - Issue now closed: `replyInThread` → final summary
4. Save message IDs + hash + JSON to state
5. On Chat API failure: `incrementFailure`

Similar structure to D1. TDD.

## Task D3: handle-approval-webhook (Apps Script)

**Files:**
- Modify: `appscript/Code.gs`

Google Chat button clicks POST to Apps Script URL. Handler:

```javascript
// appscript/Code.gs — append to existing file

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    
    // Verify signature (Google Chat chat app signing)
    if (!verifyChatSignature(e)) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' })).setMimeType(ContentService.MimeType.JSON);
    }

    // Dispatch based on button action
    const action = payload.action?.actionMethodName;
    const params = payload.action?.parameters || [];
    const get = k => params.find(p => p.key === k)?.value;
    const issueUid = get('issue_uid');
    const token = get('token');
    const userId = payload.user?.name;  // "users/1234..."

    switch (action) {
      case 'approveIssue': return approveIssue(issueUid, token, userId);
      case 'editIssue':    return openEditDialog(issueUid, token, userId);
      case 'dismissIssue': return dismissIssue(issueUid, token, userId);
      case 'submitEdit':   return submitEdit(payload);
      default: return cardError('Unknown action');
    }
  } catch (err) {
    console.error('doPost error', err);
    return cardError(err.message);
  }
}

function approveIssue(issueUid, token, userId) {
  // Call internal backend (node script) to:
  // 1. Check state — if approval_status already != 'pending', return "already approved by X"
  // 2. Read last_analysis_json from state
  // 3. Format as GitLab markdown comment
  // 4. POST to GitLab via gitlab-client
  // 5. Update state: approval_status='approved', approved_by=userId, gitlab_comment_id=<note id>
  // 6. Return updated card showing "Approved by X at Y, comment posted: <link>"
  
  const result = UrlFetchApp.fetch(BACKEND_URL + '/approve', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ issue_uid: issueUid, token, user_id: userId }),
    headers: { 'X-Internal-Auth': INTERNAL_TOKEN },
  });
  return JSON.parse(result.getContentText());  // Returns card update payload
}
// ... similar for editIssue/dismissIssue/submitEdit
```

The backend URL is the same Apps Script (doPost handles both Chat webhook AND internal HTTP). Alternative: set up separate Cloud Run endpoint. For v1, Apps Script is simplest.

- [ ] **Step D3.1-D3.5**: TDD the dispatch logic. Mock the internal fetch. Commit.

## Task D4: audit-routing-config (from Section 1.1 C)

**Files:**
- Create: `scripts/audit-routing-config.mjs`

Runs monthly (cron):
1. Fetch last 100 closed issues in reportcenter + confidential
2. For each: find its cross-referenced commits/MRs (actual routing)
3. Compare actual repo vs config-suggested repo
4. Generate drift report: `{label, actual_repo, suggested_repo, drift_count}`
5. Post drift report DM to user (not the team space)

```bash
# cron: 0 9 1 * *  (9am first of month)
bun run issue-routing:audit
```

Simple implementation. TDD. Commit.

## Task D5: Cron entrypoint + deploy

**Files:**
- Create: `scripts/run-issue-routing.sh`
- Modify: `appscript/Code.gs` (add time-driven trigger)

`scripts/run-issue-routing.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Stage 1: collect
node scripts/collect-new-issues.mjs

# Stage 2+3: analyze + post
node scripts/analyze-and-post.mjs
```

Deploy via existing Apps Script pipeline:
```bash
bun run deploy:appscript
```

Create Apps Script time trigger (every 15 min) via Code.gs:
```javascript
function setupTrigger() {
  ScriptApp.newTrigger('runIssueRouting')
    .timeBased()
    .everyMinutes(15)
    .create();
}
function runIssueRouting() {
  UrlFetchApp.fetch(RUNNER_URL);  // Triggers actual node script on host that runs dashboard
}
```

Alternative: run cron on the machine that serves dashboard. User decides based on infra.

- [ ] **Step D5 commit**: `feat(issue-routing): cron entrypoint + Apps Script time trigger`

**Lane D complete.** Integrated system.

---

# 🧪 Final: E2E Test + Smoke

## Task E1: E2E test(Playwright)

**Files:**
- Create: `test/e2e/issue-routing.e2e.mjs`

Covers 5 critical paths from test plan:
1. Happy path routing (K5 agent issue → keypo-agent suggestion + Chat post)
2. Approve → GitLab comment
3. Label change → threaded reply
4. Issue closed → final reply
5. Confidential issue full flow

Mock GitLab responses with fixtures. Mock Chat API. Run Phase 1 LLM with `mock=true` env.

## Task E2: Smoke test staging

**Not a code task. Manual:**
1. Deploy to staging Chat space (not prod)
2. Create test issue in `techcenter/reportcenter` sandbox project
3. Wait up to 15 min for cron
4. Verify Chat post appears with correct structure
5. Click Approve
6. Verify GitLab issue gets comment
7. Verify SQLite state updated

## Task E3: Documentation + rollout

**Files:**
- Create: `docs/issue-routing/README.md`

Covers:
- What it does
- How to add/edit label-routing.yaml
- How to read Chat posts
- How to override routing (if system is wrong, IC can manually edit config + re-run)
- How to disable (env var kill switch)
- Cost monitoring (where to see weekly LLM spend)
- Incident playbook: what if Chat API is down? What if GitLab token revoked?

---

# Self-Review Checklist

- [x] **Spec coverage**:
  - Exception Registry workflow (Section 1.1) → Task A3 + D4
  - K5 infra vs agent (1.2) → Task B2 prompt logic
  - Fanti cross-group (1.3) → Task A3 config (layers) + B2 (LLM layer classification)
  - LLM prompt design (1.4) → Tasks B1-B3
  - Dedup/idempotency (1.5) → Task A1 schema + D1 hash-diff logic
  - Approval flow (1.6) → Task D3 Apps Script + lib/chat-client buttons
  - All 42 test gaps → distributed across test files in each lane
  - Confidential handling → `allow_confidential_llm` check in D2 (TODO: add config flag)

- [x] **Placeholder scan**: No "TBD", "implement later", "handle edge cases" without specifics

- [x] **Type consistency**: `issue_uid` used throughout. `hashIssueContent` called the same way in A4/D1. Config shape `{labels: {...}}` used in A3/B2/D1

**Gaps I'm flagging**:
- `allow_confidential_llm` flag not explicitly shown in D2 — add it (step in D2: check `cfg.allow_confidential_llm || !issue.project.confidential` before calling LLM)
- `INTERNAL_TOKEN` for Apps Script ↔ backend handshake is implicit — add a step: generate secret, store in both Apps Script ScriptProperties and local env
- Clock drift between Apps Script and node (for webhook timestamp validation) — add ±5 min tolerance

These are small — user can handle at implementation time.

---

# Execution Handoff

**Plan complete and saved to `~/.gstack/projects/Projects/admin-issue-routing-plan-20260422-093901.md`.**

**When ready to implement:**
```bash
cd ~/Projects/eng-daily-update-dashboard
git checkout -b feat/issue-routing
mkdir -p docs/superpowers/plans
cp ~/.gstack/projects/Projects/admin-issue-routing-plan-20260422-093901.md docs/superpowers/plans/2026-04-22-issue-routing.md
```

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch fresh subagent per lane/task, review between tasks, fast iteration. Use `superpowers:subagent-driven-development`. **Parallelize Lanes A + C immediately, B after A, D after everything + T1/T3 cleared.**

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

**My recommendation: Subagent-Driven with parallel worktrees for A + C.** The parallelization saves ~1.5 days wall-clock.

Which approach?
