#!/usr/bin/env node
// scripts/handle-approval-webhook.mjs — Task D3.
// See docs/superpowers/plans/2026-04-22-issue-routing.md
//
// Local HTTP handler for Google Chat approval button actions. Called BY
// Apps Script doPost(): Chat button → Apps Script (public URL, Google-signed)
// → HTTPS to this Node handler (internal shared secret `INTERNAL_TOKEN`).
//
// Endpoints (all POST, JSON body, require X-Internal-Auth header):
//   POST /approve  { issue_uid, action_token, user_id }
//   POST /edit     { issue_uid, action_token, user_id, edit_body }
//   POST /dismiss  { issue_uid, action_token, user_id }
//
// Responses:
//   200 { status: 'approved'|'edited'|'dismissed', gitlab_note_id?, gitlab_note_url? }
//   400 { error: 'bad request ...' }
//   401 { error: 'unauthorized' }
//   403 { error: 'invalid action_token' }
//   404 { error: 'issue not found' }
//   409 { error: 'already {status} by {user} at {ts}' }
//   500 { error: 'gitlab post failed: ...' }  (state NOT updated; retry safe)
//
// All handler functions are exported so the integration test suite can drive
// them directly. buildHttpServer() exposes its internal request handler as
// `_handler` for unit-style tests that don't want to bind to a port.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStateStore } from '../lib/state.mjs';
import { createGitLabClient, GitLabApiError } from '../lib/gitlab-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const DEFAULT_PORT = 3099;

// ---------- shared helpers ----------

function parseIssueUid(uid) {
  // "PID:IID" — PID is a numeric project id, IID is the issue number (string).
  const idx = uid.indexOf(':');
  if (idx < 0) return null;
  const pid = uid.slice(0, idx);
  const iid = uid.slice(idx + 1);
  if (!pid || !iid) return null;
  return { projectId: pid, iid };
}

function fmtApprovalConflict(row) {
  return (
    `already ${row.approval_status}` +
    (row.approved_by ? ` by ${row.approved_by}` : '') +
    (row.approved_at ? ` at ${row.approved_at}` : '')
  );
}

/**
 * Build a GitLab markdown comment body. Purely formatted — no side effects.
 *
 * @param {object} opts
 * @param {object} opts.analysis  parsed last_analysis_json
 * @param {string} opts.userId    "users/1234..."
 * @param {number} opts.ts        unix seconds
 * @param {string} [opts.editBody] IC-edited plan markdown (overrides plan_draft)
 * @param {'approved'|'edited'} opts.variant
 */
function buildCommentBody({ analysis, userId, ts, editBody, variant }) {
  const lines = [];
  const header =
    variant === 'edited'
      ? '## ✏️ Edited & approved (daily-update routing system)'
      : '## ✅ Approved (daily-update routing system)';
  lines.push(header);
  lines.push('');

  if (analysis?.summary) {
    lines.push('**Summary**');
    lines.push(analysis.summary);
    lines.push('');
  }

  if (Array.isArray(analysis?.suggested_repos) && analysis.suggested_repos.length > 0) {
    lines.push('**Suggested repos**');
    for (const r of analysis.suggested_repos) lines.push(`- ${r}`);
    lines.push('');
  }

  if (Array.isArray(analysis?.suggested_assignees) && analysis.suggested_assignees.length > 0) {
    lines.push('**Suggested assignees**');
    lines.push(analysis.suggested_assignees.join(', '));
    lines.push('');
  }

  if (editBody) {
    lines.push('**Plan (IC-edited)**');
    lines.push(editBody);
    lines.push('');
  } else if (Array.isArray(analysis?.plan_draft) && analysis.plan_draft.length > 0) {
    lines.push('**Plan**');
    for (const s of analysis.plan_draft) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`_Signed off by ${userId || 'unknown'} at ${ts}._`);
  return lines.join('\n');
}

function buildNoteUrl(gitlabUrl, noteId) {
  if (!gitlabUrl || !noteId) return null;
  return `${gitlabUrl}#note_${noteId}`;
}

function verifyPending(row, actionToken) {
  if (!row) return { ok: false, status: 404, error: 'issue not found' };
  if (row.approval_status && row.approval_status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: fmtApprovalConflict(row),
    };
  }
  let analysis = null;
  try {
    analysis = row.last_analysis_json ? JSON.parse(row.last_analysis_json) : null;
  } catch {
    analysis = null;
  }
  const storedToken = analysis?.action_token;
  if (!storedToken || storedToken !== actionToken) {
    return { ok: false, status: 403, error: 'invalid action_token' };
  }
  return { ok: true, analysis };
}

function resolveProjectPath({ projectId, projectIdToPath, row }) {
  // Priority: explicit map (tests / env) → fall back to project path embedded
  // in gitlab_url (…/group/sub/project/-/issues/N).
  if (projectIdToPath && projectIdToPath[projectId]) {
    return projectIdToPath[projectId];
  }
  if (row?.gitlab_url) {
    const m = row.gitlab_url.match(
      /https?:\/\/[^/]+\/(.+?)\/-\/issues\/\d+/,
    );
    if (m) return m[1];
  }
  return null;
}

// ---------- handler: approve ----------

export async function handleApprove({
  stateStore,
  gitlabClient,
  issueUid,
  actionToken,
  userId,
  now = () => Math.floor(Date.now() / 1000),
  logger = console,
  projectIdToPath = null,
}) {
  const parsed = parseIssueUid(issueUid || '');
  if (!parsed) return json(400, { error: 'invalid issue_uid' });

  const row = stateStore.get(issueUid);
  const check = verifyPending(row, actionToken);
  if (!check.ok) return json(check.status, { error: check.error });

  const projectPath = resolveProjectPath({
    projectId: parsed.projectId,
    projectIdToPath,
    row,
  });
  if (!projectPath) {
    return json(500, { error: 'cannot resolve project path for issue_uid' });
  }

  const ts = now();
  const body = buildCommentBody({
    analysis: check.analysis,
    userId,
    ts,
    variant: 'approved',
  });

  let note;
  try {
    note = await gitlabClient.postIssueComment(projectPath, parsed.iid, body);
  } catch (err) {
    if (err instanceof GitLabApiError) {
      logger.error?.(
        `[approval] GitLab post failed for ${issueUid}: status=${err.status} retries=${err.retries}`,
      );
      return json(500, { error: `gitlab post failed: ${err.message}` });
    }
    logger.error?.(`[approval] unexpected error for ${issueUid}: ${err?.message || err}`);
    return json(500, { error: `unexpected error: ${err?.message || 'unknown'}` });
  }

  const noteId = note?.id != null ? String(note.id) : null;
  stateStore.upsert({
    ...row,
    issue_uid: row.issue_uid,
    gitlab_url: row.gitlab_url,
    labels: safeParseLabels(row.labels),
    last_analysis_hash: row.last_analysis_hash,
    last_analysis_json: row.last_analysis_json,
    last_posted_at: row.last_posted_at,
    status: row.status,
    approval_status: 'approved',
    approved_by: userId,
    approved_at: ts,
    gitlab_comment_id: noteId,
    post_failures: row.post_failures ?? 0,
    created_at: row.created_at,
    updated_at: ts,
  });

  return json(200, {
    status: 'approved',
    gitlab_note_id: note?.id ?? null,
    gitlab_note_url: buildNoteUrl(row.gitlab_url, noteId),
  });
}

// ---------- handler: edit ----------

export async function handleEdit({
  stateStore,
  gitlabClient,
  issueUid,
  actionToken,
  userId,
  editBody,
  now = () => Math.floor(Date.now() / 1000),
  logger = console,
  projectIdToPath = null,
}) {
  if (!editBody || typeof editBody !== 'string' || editBody.trim().length === 0) {
    return json(400, { error: 'edit_body is required and must be non-empty' });
  }

  const parsed = parseIssueUid(issueUid || '');
  if (!parsed) return json(400, { error: 'invalid issue_uid' });

  const row = stateStore.get(issueUid);
  const check = verifyPending(row, actionToken);
  if (!check.ok) return json(check.status, { error: check.error });

  const projectPath = resolveProjectPath({
    projectId: parsed.projectId,
    projectIdToPath,
    row,
  });
  if (!projectPath) {
    return json(500, { error: 'cannot resolve project path for issue_uid' });
  }

  const ts = now();
  const body = buildCommentBody({
    analysis: check.analysis,
    userId,
    ts,
    editBody,
    variant: 'edited',
  });

  let note;
  try {
    note = await gitlabClient.postIssueComment(projectPath, parsed.iid, body);
  } catch (err) {
    if (err instanceof GitLabApiError) {
      logger.error?.(
        `[approval/edit] GitLab post failed for ${issueUid}: status=${err.status}`,
      );
      return json(500, { error: `gitlab post failed: ${err.message}` });
    }
    return json(500, { error: `unexpected error: ${err?.message || 'unknown'}` });
  }

  const noteId = note?.id != null ? String(note.id) : null;
  stateStore.upsert({
    ...row,
    labels: safeParseLabels(row.labels),
    approval_status: 'edited',
    approved_by: userId,
    approved_at: ts,
    gitlab_comment_id: noteId,
    updated_at: ts,
  });

  return json(200, {
    status: 'edited',
    gitlab_note_id: note?.id ?? null,
    gitlab_note_url: buildNoteUrl(row.gitlab_url, noteId),
  });
}

// ---------- handler: dismiss ----------

export async function handleDismiss({
  stateStore,
  issueUid,
  actionToken,
  userId,
  now = () => Math.floor(Date.now() / 1000),
  logger = console,
}) {
  const parsed = parseIssueUid(issueUid || '');
  if (!parsed) return json(400, { error: 'invalid issue_uid' });

  const row = stateStore.get(issueUid);
  const check = verifyPending(row, actionToken);
  if (!check.ok) return json(check.status, { error: check.error });

  const ts = now();
  stateStore.upsert({
    ...row,
    labels: safeParseLabels(row.labels),
    approval_status: 'dismissed',
    approved_by: userId,
    approved_at: ts,
    updated_at: ts,
  });

  logger.log?.(`[approval/dismiss] ${issueUid} dismissed by ${userId}`);
  return json(200, { status: 'dismissed' });
}

// ---------- HTTP server ----------

function json(status, body) {
  return { status, body };
}

function safeParseLabels(labels) {
  if (Array.isArray(labels)) return labels;
  if (typeof labels === 'string') {
    try {
      const parsed = JSON.parse(labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build an http.Server plus expose its request handler at `server._handler`
 * so tests can drive it with synthetic (req, res) objects.
 */
export function buildHttpServer({
  stateStore,
  gitlabClient,
  internalToken,
  logger = console,
  now = () => Math.floor(Date.now() / 1000),
  projectIdToPath = null,
}) {
  const handler = async (req, res) => {
    try {
      // Only POST is supported.
      if (req.method !== 'POST') {
        return writeJson(res, 405, { error: 'method not allowed' });
      }

      // Internal auth check — constant path before any DB work.
      const got = req.headers['x-internal-auth'];
      if (!internalToken || !got || got !== internalToken) {
        return writeJson(res, 401, { error: 'unauthorized' });
      }

      const url = (req.url || '').split('?')[0];
      const endpoint =
        url === '/approve' ? 'approve'
        : url === '/edit' ? 'edit'
        : url === '/dismiss' ? 'dismiss'
        : null;

      if (!endpoint) {
        return writeJson(res, 400, { error: `unknown endpoint: ${url}` });
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch {
        return writeJson(res, 400, { error: 'invalid json body' });
      }

      const common = {
        stateStore,
        gitlabClient,
        issueUid: payload.issue_uid,
        actionToken: payload.action_token,
        userId: payload.user_id,
        now,
        logger,
        projectIdToPath,
      };

      let result;
      if (endpoint === 'approve') {
        result = await handleApprove(common);
      } else if (endpoint === 'edit') {
        result = await handleEdit({ ...common, editBody: payload.edit_body });
      } else {
        result = await handleDismiss(common);
      }

      return writeJson(res, result.status, result.body);
    } catch (err) {
      logger.error?.('[approval/server] fatal:', err?.message || err);
      return writeJson(res, 500, { error: 'internal error' });
    }
  };

  const server = http.createServer((req, res) => {
    handler(req, res);
  });
  // Expose handler for tests.
  server._handler = handler;
  return server;
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------- main ----------

async function main() {
  const internalToken = process.env.INTERNAL_TOKEN;
  if (!internalToken) {
    console.error('[approval] INTERNAL_TOKEN env var is required');
    process.exit(2);
  }

  let gitlabCfg;
  try {
    const gitlabConfigPath =
      process.env.GITLAB_CONFIG || join(REPO_ROOT, 'gitlab-config.json');
    gitlabCfg = JSON.parse(readFileSync(gitlabConfigPath, 'utf8'));
  } catch (err) {
    console.error('[approval] invalid gitlab-config.json:', err.message);
    process.exit(2);
  }

  const dbPath = process.env.STATE_DB || join(REPO_ROOT, 'db', 'issue-routing.sqlite');
  const store = createStateStore(dbPath);
  const gitlabClient = createGitLabClient({
    baseUrl: gitlabCfg.baseUrl,
    token: gitlabCfg.token,
  });

  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = buildHttpServer({
    stateStore: store,
    gitlabClient,
    internalToken,
  });

  server.listen(port, () => {
    console.log(`[approval] listening on :${port}`);
  });

  const shutdown = () => {
    console.log('[approval] shutting down...');
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[approval] FATAL', e);
    process.exit(1);
  });
}
