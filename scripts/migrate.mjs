#!/usr/bin/env node
// Apply pending SQL migrations from db/migrations/ to the issue-routing SQLite file.
// Idempotent: uses IF NOT EXISTS / ON CONFLICT everywhere, safe to re-run.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A1.

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'db', 'issue-routing.sqlite');
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

export function migrate(dbPath = DEFAULT_DB_PATH) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    db.exec(sql);
  }

  const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  db.close();
  return { applied: files.length, version: version?.v ?? 0, dbPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = migrate();
  console.log(`[migrate] applied ${result.applied} files → ${result.dbPath} (schema v${result.version})`);
}
