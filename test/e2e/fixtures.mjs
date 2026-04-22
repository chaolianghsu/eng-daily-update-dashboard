// Shared fixture factory for issue-routing E2E tests.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task E1.
//
// These fixtures give tests a realistic "system under test" setup:
//   - Fresh in-memory-ish tmp SQLite DB (real schema via migrate())
//   - Mock GitLab client (resolveProjectId / fetchOpenIssues / fetchIssue /
//     fetchIssueNotes / postIssueComment) with configurable issue payloads
//   - Mock Chat client (postCard / replyInThread / updateCard) with vi.fn()
//   - Mock LLM phase1 / phase2 functions (stateless, return canned shapes)
//   - Realistic sample issues (K5 agent, confidential) matching the real
//     GitLab JSON shape the pipeline expects.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';
import { migrate } from '../../scripts/migrate.mjs';
import { createStateStore } from '../../lib/state.mjs';

/**
 * Create a fresh tmp SQLite DB with the issue-routing schema applied, plus
 * a state store bound to it. Returns a cleanup() to remove the tmp dir.
 */
export function makeFreshStateStore() {
  const tmp = mkdtempSync(join(tmpdir(), 'e2e-routing-'));
  const dbPath = join(tmp, 'state.sqlite');
  migrate(dbPath);
  const store = createStateStore(dbPath);
  return {
    store,
    dbPath,
    tmp,
    cleanup() {
      try { store.close(); } catch {}
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    },
  };
}

/**
 * Mock GitLab client. The `issues` array is what fetchOpenIssues returns (for
 * the collect stage). fetchIssue looks up an issue by iid from that array.
 * fetchIssueNotes returns []. postIssueComment is a vi.fn() returning an id.
 */
export function mockGitLabClient({
  issues = [],
  projectId = 631,
  postCommentResponse = { id: 99001, body: '(comment)' },
} = {}) {
  return {
    resolveProjectId: vi.fn().mockResolvedValue(projectId),
    fetchOpenIssues: vi.fn().mockResolvedValue(issues),
    fetchIssue: vi.fn(async (_path, iid) => {
      const match = issues.find((i) => i.iid === Number(iid) || i.iid === iid);
      if (!match) throw new Error(`mockGitLabClient: no fixture issue with iid=${iid}`);
      return match;
    }),
    fetchIssueNotes: vi.fn().mockResolvedValue([]),
    postIssueComment: vi.fn().mockResolvedValue(postCommentResponse),
  };
}

/** Mock Chat client with realistic Google Chat response shapes. */
export function mockChatClient({
  postCardResponse,
  replyResponse,
} = {}) {
  const defaultPost = postCardResponse ?? {
    name: 'spaces/TEST/messages/MSG_NEW',
    thread: { name: 'spaces/TEST/threads/T_NEW' },
  };
  const defaultReply = replyResponse ?? {
    name: 'spaces/TEST/messages/MSG_REPLY',
  };
  return {
    postCard: vi.fn().mockResolvedValue(defaultPost),
    replyInThread: vi.fn().mockResolvedValue(defaultReply),
    updateCard: vi.fn().mockResolvedValue({ name: 'spaces/TEST/messages/MSG_UPDATE' }),
  };
}

/** Phase 1 routing mock — returns a vi.fn() with a canned result. */
export function mockPhase1(overrides = {}) {
  return vi.fn().mockResolvedValue({
    confidence: 0.85,
    suggested_repos: ['llmprojects/keypo-agent'],
    suggested_assignees: ['u1'],
    reasoning: 'strong signal: K5 label + agent keyword in title',
    layer: 'n/a',
    caveats: [],
    ...overrides,
  });
}

/** Phase 2 plan-draft mock — returns a vi.fn() with a canned result. */
export function mockPhase2(overrides = {}) {
  return vi.fn().mockResolvedValue({
    summary: '檢查 keypo agent 回覆失敗的 root cause',
    plan_draft: [
      '1. 重現錯誤 (複製 user 的 prompt)',
      '2. 檢查 agent server logs',
      '3. 修復或回報 upstream bug',
    ],
    ...overrides,
  });
}

/**
 * Realistic K5+P1_高 "keypo agent chat 回覆失敗" sample issue from
 * techcenter/reportcenter. Matches the GitLab API response shape that
 * fetchOpenIssues / fetchIssue return.
 */
export function sampleK5AgentIssue({
  iid = 3062,
  state = 'opened',
  labels = ['K5', 'P1_高'],
  description = 'keypo agent 在多輪對話後回覆為空字串,user 無法得到結果。',
  title = 'keypo agent chat 回覆失敗',
} = {}) {
  return {
    iid,
    title,
    description,
    labels,
    state,
    web_url: `https://gitlab.example.com/techcenter/reportcenter/-/issues/${iid}`,
  };
}

/**
 * Realistic confidential-project sample issue from
 * techcenter/reportcenter_confidential.
 */
export function sampleConfidentialIssue({
  iid = 400,
  state = 'opened',
  labels = ['K5'],
  description = '內部專案 confidential — keypo agent 重要客戶錯誤。',
  title = '[confidential] keypo agent 疑似 data leak',
} = {}) {
  return {
    iid,
    title,
    description,
    labels,
    state,
    web_url: `https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/${iid}`,
  };
}

/**
 * Silent logger for tests so assertion output isn't drowned in [collect] / [analyze] noise.
 */
export function silentLogger() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Minimal label_config covering the labels used in the E2E fixtures.
 * Mirrors the real config/label-routing.yaml shape.
 */
export function sampleLabelConfig() {
  return {
    labels: {
      K5: {
        product: 'KEYPO',
        primary_group: 'KEYPO',
        known_exceptions: ['llmprojects/keypo-agent'],
      },
      BD: {
        product: 'BigData',
        primary_group: 'bigdata',
        known_exceptions: [],
      },
      Fanti: {
        product: 'Fanti',
        primary_group: null,
        layers: {
          crawler: ['CrawlersV2/fanti-insights-api'],
          backend: ['cdp/fanti-insights-backend'],
        },
      },
    },
    ignore_for_routing: ['P1_高', 'Bug'],
  };
}
