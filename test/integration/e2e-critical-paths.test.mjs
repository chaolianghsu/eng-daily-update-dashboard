// E2E critical-path tests for the issue-routing pipeline.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task E1.
//
// These tests drive the full pipeline end-to-end: Stage 1 (collect) →
// Stage 2+3 (analyze + post) → Stage 4 (approval webhook) with MOCK
// external services (GitLab + Chat + LLM). The state store is a real
// SQLite DB in a tmp dir — it's the integration glue we most want
// covered.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runCollect } from '../../scripts/collect-new-issues.mjs';
import { runAnalyzeAndPost } from '../../scripts/analyze-and-post.mjs';
import {
  handleApprove,
  handleEdit,
  handleDismiss,
} from '../../scripts/handle-approval-webhook.mjs';

import {
  makeFreshStateStore,
  mockGitLabClient,
  mockChatClient,
  mockPhase1,
  mockPhase2,
  sampleK5AgentIssue,
  sampleConfidentialIssue,
  silentLogger,
  sampleLabelConfig,
} from '../e2e/fixtures.mjs';

// ---------------------------------------------------------------------------
// Path 1 — Happy routing: new issue → collect → analyze → Chat post
// ---------------------------------------------------------------------------

describe('E2E — Path 1: Happy routing (new issue → Chat post)', () => {
  let env;

  beforeEach(() => {
    env = makeFreshStateStore();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('collects + analyzes + posts a new K5+P1_高 agent issue', async () => {
    const issue = sampleK5AgentIssue({ iid: 3062 });
    const gitlab = mockGitLabClient({ issues: [issue], projectId: 631 });
    const chat = mockChatClient();
    const phase1 = mockPhase1();
    const phase2 = mockPhase2();

    // Stage 1: collect
    const collectSummary = await runCollect({
      stateStore: env.store,
      client: gitlab,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });
    expect(collectSummary.queued).toBe(1);
    expect(collectSummary.processed).toBe(1);

    // Stage 2+3: analyze + post
    const analyzeSummary = await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlab,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: phase1,
      phase2Fn: phase2,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-p1',
    });

    expect(analyzeSummary.posted_new).toBe(1);
    expect(analyzeSummary.errors).toBe(0);

    // postCard called exactly once; replyInThread never.
    expect(chat.postCard).toHaveBeenCalledTimes(1);
    expect(chat.replyInThread).not.toHaveBeenCalled();

    // State row exists with primary_msg_id set and approval_status='pending'.
    const row = env.store.get('631:3062');
    expect(row).not.toBeNull();
    expect(row.primary_msg_id).toBe('spaces/TEST/messages/MSG_NEW');
    expect(row.thread_id).toBe('spaces/TEST/threads/T_NEW');
    expect(row.approval_status).toBe('pending');

    // last_analysis_json.posted_hash equals current issue hash.
    const stored = JSON.parse(row.last_analysis_json);
    expect(stored.posted_hash).toBe(row.last_analysis_hash);
    expect(stored.action_token).toBe('tok-p1');

    // Card content contains 'llmprojects/keypo-agent' in suggested_repos (pulled from phase1).
    const [, cardArg] = chat.postCard.mock.calls[0];
    const rendered = JSON.stringify(cardArg);
    expect(rendered).toContain('llmprojects/keypo-agent');
  });
});

// ---------------------------------------------------------------------------
// Path 2 — Approval → GitLab comment
// ---------------------------------------------------------------------------

describe('E2E — Path 2: Approval → GitLab comment', () => {
  let env;

  beforeEach(() => {
    env = makeFreshStateStore();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('handleApprove posts comment to GitLab and updates state to approved', async () => {
    // Reconstruct "Path 1 end state" by running collect+analyze first.
    const issue = sampleK5AgentIssue({ iid: 3062 });
    const gitlab = mockGitLabClient({ issues: [issue], projectId: 631 });
    const chat = mockChatClient();
    const phase1 = mockPhase1();
    const phase2 = mockPhase2();

    await runCollect({
      stateStore: env.store,
      client: gitlab,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlab,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: phase1,
      phase2Fn: phase2,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-p2',
    });

    // Sanity: state row is pending with a known action_token.
    const pre = env.store.get('631:3062');
    expect(pre.approval_status).toBe('pending');

    // Now simulate the approval click.
    const res = await handleApprove({
      stateStore: env.store,
      gitlabClient: gitlab,
      issueUid: '631:3062',
      actionToken: 'tok-p2',
      userId: 'users/u-reviewer',
      now: () => 3000,
      logger: silentLogger(),
      projectIdToPath: { 631: 'techcenter/reportcenter' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');

    // GitLab comment posted with the right project path + iid.
    expect(gitlab.postIssueComment).toHaveBeenCalledTimes(1);
    const [projPathArg, iidArg] = gitlab.postIssueComment.mock.calls[0];
    expect(projPathArg).toBe('techcenter/reportcenter');
    expect(iidArg).toBe('3062');

    // State row updated as approved.
    const post = env.store.get('631:3062');
    expect(post.approval_status).toBe('approved');
    expect(post.approved_by).toBe('users/u-reviewer');
    expect(post.approved_at).toBe(3000);
    expect(post.gitlab_comment_id).toBe('99001');
  });
});

// ---------------------------------------------------------------------------
// Path 3 — Label change → threaded reply (not a new card)
// ---------------------------------------------------------------------------

describe('E2E — Path 3: Label change → threaded reply', () => {
  let env;

  beforeEach(() => {
    env = makeFreshStateStore();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('re-runs when labels change and replies into existing thread', async () => {
    // --- First run: K5 only -------------------------------------------------
    const issueV1 = sampleK5AgentIssue({ iid: 3062, labels: ['K5'] });
    const gitlabV1 = mockGitLabClient({ issues: [issueV1], projectId: 631 });
    const chat = mockChatClient();

    await runCollect({
      stateStore: env.store,
      client: gitlabV1,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlabV1,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: mockPhase1(),
      phase2Fn: mockPhase2(),
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-v1',
    });

    expect(chat.postCard).toHaveBeenCalledTimes(1);

    // --- Second run: labels now include Bug -------------------------------
    const issueV2 = sampleK5AgentIssue({ iid: 3062, labels: ['K5', 'Bug'] });
    const gitlabV2 = mockGitLabClient({ issues: [issueV2], projectId: 631 });

    await runCollect({
      stateStore: env.store,
      client: gitlabV2,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 3000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlabV2,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: mockPhase1(),
      phase2Fn: mockPhase2(),
      logger: silentLogger(),
      now: () => 4000,
      generateToken: () => 'tok-v2',
    });

    // replyInThread called once (NOT a second postCard).
    expect(chat.postCard).toHaveBeenCalledTimes(1);
    expect(chat.replyInThread).toHaveBeenCalledTimes(1);

    const [spaceArg, threadArg, cardArg] = chat.replyInThread.mock.calls[0];
    expect(spaceArg).toBe('spaces/TEST');
    expect(threadArg).toBe('spaces/TEST/threads/T_NEW');

    // Card content reflects the new labels (the subtitle renders them).
    const rendered = JSON.stringify(cardArg);
    expect(rendered).toContain('Bug');
    expect(rendered).toContain('K5');
  });
});

// ---------------------------------------------------------------------------
// Path 4 — Closed event → final threaded reply
// ---------------------------------------------------------------------------

describe('E2E — Path 4: Closed event → final threaded reply', () => {
  let env;

  beforeEach(() => {
    env = makeFreshStateStore();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('transitions state to closed and replies in thread on close, then skips on re-run', async () => {
    // First pass: open state, initial post.
    const openIssue = sampleK5AgentIssue({ iid: 3062, state: 'opened' });
    const gitlabOpen = mockGitLabClient({ issues: [openIssue], projectId: 631 });
    const chat = mockChatClient();

    await runCollect({
      stateStore: env.store,
      client: gitlabOpen,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 1000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlabOpen,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: mockPhase1(),
      phase2Fn: mockPhase2(),
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-o',
    });

    expect(chat.postCard).toHaveBeenCalledTimes(1);

    // Second pass: issue now closed.
    const closedIssue = sampleK5AgentIssue({ iid: 3062, state: 'closed' });
    const gitlabClosed = mockGitLabClient({ issues: [closedIssue], projectId: 631 });

    await runCollect({
      stateStore: env.store,
      client: gitlabClosed,
      projectPaths: ['techcenter/reportcenter'],
      logger: silentLogger(),
      now: () => 3000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlabClosed,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: mockPhase1(),
      phase2Fn: mockPhase2(),
      logger: silentLogger(),
      now: () => 4000,
      generateToken: () => 'tok-c',
    });

    // Closed path uses replyInThread, not a second postCard.
    expect(chat.postCard).toHaveBeenCalledTimes(1);
    expect(chat.replyInThread).toHaveBeenCalledTimes(1);

    const row = env.store.get('631:3062');
    expect(row.status).toBe('closed');

    // Third pass: another analyze call — closed rows no longer in open list.
    chat.replyInThread.mockClear();
    const summaryAfter = await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlabClosed,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      spaceId: 'spaces/TEST',
      phase1Fn: mockPhase1(),
      phase2Fn: mockPhase2(),
      logger: silentLogger(),
      now: () => 5000,
    });
    expect(summaryAfter.processed).toBe(0);
    expect(chat.replyInThread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Path 5 — Confidential issue full flow (allow_confidential_llm=true)
// ---------------------------------------------------------------------------

describe('E2E — Path 5: Confidential full flow (allow_confidential_llm=true)', () => {
  let env;

  beforeEach(() => {
    env = makeFreshStateStore();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('runs phase1+phase2 and posts card for a confidential project when allow=true', async () => {
    const issue = sampleConfidentialIssue({ iid: 400 });
    const gitlab = mockGitLabClient({ issues: [issue], projectId: 700 });
    const chat = mockChatClient();
    const phase1 = mockPhase1();
    const phase2 = mockPhase2();

    await runCollect({
      stateStore: env.store,
      client: gitlab,
      projectPaths: ['techcenter/reportcenter_confidential'],
      logger: silentLogger(),
      now: () => 1000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlab,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      allowConfidentialLLM: true,
      spaceId: 'spaces/TEST',
      phase1Fn: phase1,
      phase2Fn: phase2,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-conf',
    });

    // Standard routing flow runs identically: both LLM phases called + card posted.
    expect(phase1).toHaveBeenCalledTimes(1);
    expect(phase2).toHaveBeenCalledTimes(1);
    expect(chat.postCard).toHaveBeenCalledTimes(1);

    const row = env.store.get('700:400');
    expect(row).not.toBeNull();
    expect(row.primary_msg_id).toBe('spaces/TEST/messages/MSG_NEW');
  });

  it('skips LLM and uses fallback for confidential when allow=false', async () => {
    const issue = sampleConfidentialIssue({ iid: 401 });
    const gitlab = mockGitLabClient({ issues: [issue], projectId: 700 });
    const chat = mockChatClient();
    const phase1 = mockPhase1();
    const phase2 = mockPhase2();

    await runCollect({
      stateStore: env.store,
      client: gitlab,
      projectPaths: ['techcenter/reportcenter_confidential'],
      logger: silentLogger(),
      now: () => 1000,
    });

    await runAnalyzeAndPost({
      stateStore: env.store,
      gitlabClient: gitlab,
      chatClient: chat,
      labelConfig: sampleLabelConfig(),
      allowConfidentialLLM: false,
      spaceId: 'spaces/TEST',
      phase1Fn: phase1,
      phase2Fn: phase2,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-conf-skip',
    });

    // LLM must NOT be called when allow=false on confidential project.
    expect(phase1).not.toHaveBeenCalled();
    expect(phase2).not.toHaveBeenCalled();
    // Card still goes out (labels-only fallback).
    expect(chat.postCard).toHaveBeenCalledTimes(1);

    const row = env.store.get('700:401');
    const stored = JSON.parse(row.last_analysis_json);
    expect(stored.summary).toMatch(/Confidential/i);
    expect(stored.plan_draft).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sanity — state row count across paths
// ---------------------------------------------------------------------------

describe('E2E — sanity counter: total state rows after all paths', () => {
  it('seeds three independent paths and ends with 3 rows total', async () => {
    const env = makeFreshStateStore();
    try {
      // Path-1-ish: 631:3062
      const gitlab1 = mockGitLabClient({
        issues: [sampleK5AgentIssue({ iid: 3062 })],
        projectId: 631,
      });
      await runCollect({
        stateStore: env.store,
        client: gitlab1,
        projectPaths: ['techcenter/reportcenter'],
        logger: silentLogger(),
        now: () => 1000,
      });

      // Path-5-ish: 700:400 (confidential)
      const gitlab2 = mockGitLabClient({
        issues: [sampleConfidentialIssue({ iid: 400 })],
        projectId: 700,
      });
      await runCollect({
        stateStore: env.store,
        client: gitlab2,
        projectPaths: ['techcenter/reportcenter_confidential'],
        logger: silentLogger(),
        now: () => 2000,
      });

      // Plus one arbitrary extra open issue in the pub project.
      const gitlab3 = mockGitLabClient({
        issues: [sampleK5AgentIssue({ iid: 3063, title: 'another K5 report' })],
        projectId: 631,
      });
      await runCollect({
        stateStore: env.store,
        client: gitlab3,
        projectPaths: ['techcenter/reportcenter'],
        logger: silentLogger(),
        now: () => 3000,
      });

      const open = env.store.listByStatus('open');
      expect(open.length).toBe(3);
    } finally {
      env.cleanup();
    }
  });
});
