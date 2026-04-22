// Integration tests for scripts/analyze-and-post.mjs — Stage 2+3 of issue routing DAG.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task D2.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { migrate } from '../../scripts/migrate.mjs';
import { createStateStore } from '../../lib/state.mjs';
import { ChatApiError } from '../../lib/chat-client.mjs';
import { LLMApiError } from '../../lib/llm/phase1-routing.mjs';
import { hashIssueContent } from '../../lib/hash.mjs';
import { runAnalyzeAndPost } from '../../scripts/analyze-and-post.mjs';

// -- Fixtures -----------------------------------------------------------------

function silentLogger() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeLabelConfig() {
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

function makeGitLabIssue(overrides = {}) {
  return {
    iid: 1,
    title: 'Test issue',
    description: 'some description',
    labels: ['K5'],
    state: 'opened',
    web_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/1',
    ...overrides,
  };
}

function makeGitlabClient(overrides = {}) {
  return {
    resolveProjectId: vi.fn().mockResolvedValue(631),
    fetchIssue: vi.fn().mockResolvedValue(makeGitLabIssue()),
    fetchIssueNotes: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeChatClient(overrides = {}) {
  return {
    postCard: vi.fn().mockResolvedValue({
      name: 'spaces/X/messages/MSG1',
      thread: { name: 'spaces/X/threads/T1' },
    }),
    replyInThread: vi.fn().mockResolvedValue({
      name: 'spaces/X/messages/MSG2',
    }),
    updateCard: vi.fn(),
    ...overrides,
  };
}

function makePhase1(overrides = {}) {
  return {
    confidence: 0.8,
    suggested_repos: ['llmprojects/keypo-agent'],
    suggested_assignees: ['u1'],
    reasoning: 'Strong match on K5 label',
    layer: 'n/a',
    caveats: [],
    ...overrides,
  };
}

function makePhase2(overrides = {}) {
  return {
    summary: 'Summary text',
    plan_draft: ['step1', 'step2'],
    ...overrides,
  };
}

// Seed a pending-analysis issue into the state store (mimics D1 collect output).
function seedIssue(store, {
  uid = '631:1',
  url = 'https://gitlab.example.com/techcenter/reportcenter/-/issues/1',
  labels = ['K5'],
  description = 'some description',
  state = 'opened',
  status = 'open',
  primary_msg_id = null,
  thread_id = null,
  last_analysis_json = null,
  ts = 1000,
} = {}) {
  const hash = hashIssueContent({ labels, description, state });
  store.upsert({
    issue_uid: uid,
    gitlab_url: url,
    labels,
    thread_id,
    primary_msg_id,
    last_analysis_hash: hash,
    last_analysis_json,
    status,
    created_at: ts,
    updated_at: ts,
  });
  return { uid, hash };
}

// -----------------------------------------------------------------------------

describe('analyze-and-post (runAnalyzeAndPost)', () => {
  let tmp, dbPath, store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'analyze-test-'));
    dbPath = join(tmp, 'test.sqlite');
    migrate(dbPath);
    store = createStateStore(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it('new issue (no primary_msg_id) → calls postCard; stores thread_id + primary_msg_id', async () => {
    seedIssue(store, { uid: '631:1', labels: ['K5'], description: 'Hello world' });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn().mockResolvedValue(
        makeGitLabIssue({ iid: 1, title: 'New K5 issue', description: 'Hello world', labels: ['K5'] }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-abc',
    });

    expect(summary.posted_new).toBe(1);
    expect(summary.threaded_updates).toBe(0);
    expect(summary.errors).toBe(0);

    expect(chatClient.postCard).toHaveBeenCalledTimes(1);
    expect(chatClient.replyInThread).not.toHaveBeenCalled();

    const row = store.get('631:1');
    expect(row.primary_msg_id).toBe('spaces/X/messages/MSG1');
    expect(row.thread_id).toBe('spaces/X/threads/T1');
    expect(row.last_posted_at).toBe(2000);

    const stored = JSON.parse(row.last_analysis_json);
    expect(stored.posted_hash).toBe(row.last_analysis_hash);
    expect(stored.action_token).toBe('tok-abc');
  });

  it('existing issue + hash unchanged → skip entirely (no LLM, no post)', async () => {
    const { uid, hash } = seedIssue(store, {
      uid: '631:2',
      labels: ['K5'],
      description: 'stable',
      primary_msg_id: 'spaces/X/messages/MSG_OLD',
      thread_id: 'spaces/X/threads/T_OLD',
    });
    // Store analysis JSON with posted_hash == current hash → already posted this version
    store.upsert({
      issue_uid: uid,
      gitlab_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/X',
      labels: ['K5'],
      thread_id: 'spaces/X/threads/T_OLD',
      primary_msg_id: 'spaces/X/messages/MSG_OLD',
      last_analysis_hash: hash,
      last_analysis_json: JSON.stringify({ posted_hash: hash, action_token: 'tok-old' }),
      status: 'open',
      created_at: 1000,
      updated_at: 1000,
    });

    const gitlabClient = makeGitlabClient();
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn();
    const phase2Fn = vi.fn();

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 5000,
    });

    expect(summary.skipped).toBe(1);
    expect(summary.posted_new).toBe(0);
    expect(phase1Fn).not.toHaveBeenCalled();
    expect(phase2Fn).not.toHaveBeenCalled();
    expect(chatClient.postCard).not.toHaveBeenCalled();
    expect(chatClient.replyInThread).not.toHaveBeenCalled();
  });

  it('existing issue + labels changed → calls replyInThread with update', async () => {
    // Seed a row that was previously posted with labels ['K5'], hash old.
    const oldHash = hashIssueContent({ labels: ['K5'], description: 'x', state: 'opened' });
    store.upsert({
      issue_uid: '631:3',
      gitlab_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/X',
      labels: ['K5'],
      thread_id: 'spaces/X/threads/T3',
      primary_msg_id: 'spaces/X/messages/MSG3',
      last_analysis_hash: oldHash,
      last_analysis_json: JSON.stringify({ posted_hash: oldHash, action_token: 'tok-old' }),
      status: 'open',
      created_at: 500,
      updated_at: 500,
    });
    // Now collector has updated the row: labels changed → new hash.
    const newHash = hashIssueContent({ labels: ['K5', 'BD'], description: 'x', state: 'opened' });
    store.upsert({
      issue_uid: '631:3',
      gitlab_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/X',
      labels: ['K5', 'BD'],
      last_analysis_hash: newHash,
      status: 'open',
      created_at: 500,
      updated_at: 1000,
    });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn().mockResolvedValue(
        makeGitLabIssue({ iid: 3, labels: ['K5', 'BD'], description: 'x' }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(summary.threaded_updates).toBe(1);
    expect(summary.posted_new).toBe(0);
    expect(chatClient.replyInThread).toHaveBeenCalledTimes(1);
    const [spaceArg, threadArg] = chatClient.replyInThread.mock.calls[0];
    expect(spaceArg).toBe('spaces/X');
    expect(threadArg).toBe('spaces/X/threads/T3');
  });

  it('issue transitioned to closed → replyInThread with closed summary', async () => {
    // Seed with open state + prior post.
    const priorHash = hashIssueContent({ labels: ['K5'], description: 'y', state: 'opened' });
    store.upsert({
      issue_uid: '631:4',
      gitlab_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/X',
      labels: ['K5'],
      thread_id: 'spaces/X/threads/T4',
      primary_msg_id: 'spaces/X/messages/MSG4',
      last_analysis_hash: priorHash,
      last_analysis_json: JSON.stringify({ posted_hash: priorHash, action_token: 'tok' }),
      status: 'open',
      created_at: 500,
      updated_at: 500,
    });
    // Collector observed state=closed → updated hash.
    const newHash = hashIssueContent({ labels: ['K5'], description: 'y', state: 'closed' });
    store.upsert({
      issue_uid: '631:4',
      gitlab_url: 'https://gitlab.example.com/techcenter/reportcenter/-/issues/X',
      labels: ['K5'],
      last_analysis_hash: newHash,
      status: 'open', // collect-new-issues currently keeps status='open'; analyze transitions it
      created_at: 500,
      updated_at: 1000,
    });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn().mockResolvedValue(
        makeGitLabIssue({ iid: 4, labels: ['K5'], description: 'y', state: 'closed' }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(summary.threaded_updates).toBe(1);
    expect(chatClient.replyInThread).toHaveBeenCalledTimes(1);
    const row = store.get('631:4');
    expect(row.status).toBe('closed');
  });

  it('confidential project + allow_confidential_llm=false → skips LLM, uses fallback', async () => {
    seedIssue(store, {
      uid: '700:7',
      url: 'https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/7',
      labels: ['K5'],
      description: 'sensitive content',
    });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn().mockResolvedValue(
        makeGitLabIssue({
          iid: 7,
          labels: ['K5'],
          description: 'sensitive content',
          web_url: 'https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/7',
        }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn();
    const phase2Fn = vi.fn();

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      allowConfidentialLLM: false,
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'tok-conf',
    });

    expect(summary.posted_new).toBe(1);
    expect(phase1Fn).not.toHaveBeenCalled();
    expect(phase2Fn).not.toHaveBeenCalled();
    expect(chatClient.postCard).toHaveBeenCalledTimes(1);

    const row = store.get('700:7');
    const stored = JSON.parse(row.last_analysis_json);
    expect(stored.summary).toMatch(/Confidential/i);
    expect(stored.confidence).toBeLessThan(0.5);
    expect(stored.plan_draft).toBeNull();
  });

  it('confidential project + allow_confidential_llm=true (default) → full pipeline runs', async () => {
    seedIssue(store, {
      uid: '700:8',
      url: 'https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/8',
      labels: ['K5'],
      description: 'c',
    });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn().mockResolvedValue(
        makeGitLabIssue({
          iid: 8,
          labels: ['K5'],
          description: 'c',
          web_url: 'https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/8',
        }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      // allowConfidentialLLM defaults to true
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(phase1Fn).toHaveBeenCalledTimes(1);
    expect(phase2Fn).toHaveBeenCalledTimes(1);
  });

  it('phase1 confidence < 0.5 → phase2 is NOT called', async () => {
    seedIssue(store, { uid: '631:9', labels: ['K5'], description: 'd' });

    const gitlabClient = makeGitlabClient();
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1({ confidence: 0.3 }));
    const phase2Fn = vi.fn();

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(phase1Fn).toHaveBeenCalledTimes(1);
    expect(phase2Fn).not.toHaveBeenCalled();
    expect(summary.posted_new).toBe(1);
  });

  it('Chat API error → incrementFailure called; other issues still processed', async () => {
    // Use different ts to guarantee ordering (listByStatus ORDER BY updated_at DESC):
    // 631:10 updated_at=2000 → processed first; 631:11 updated_at=1000 → processed second.
    seedIssue(store, { uid: '631:10', labels: ['K5'], description: 'one', ts: 2000 });
    seedIssue(store, { uid: '631:11', labels: ['BD'], description: 'two', ts: 1000 });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn(async (_path, iid) =>
        makeGitLabIssue({ iid, labels: iid === 10 ? ['K5'] : ['BD'], description: iid === 10 ? 'one' : 'two' }),
      ),
    });
    const chatClient = makeChatClient({
      postCard: vi.fn()
        .mockRejectedValueOnce(new ChatApiError('Chat 500', { status: 500, endpoint: '/x', retries: 3 }))
        .mockResolvedValueOnce({ name: 'spaces/X/messages/OK', thread: { name: 'spaces/X/threads/OK' } }),
    });
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(summary.errors).toBe(1);
    // Failure increment happened on the failed issue
    const row10 = store.get('631:10');
    const row11 = store.get('631:11');
    expect(row10.post_failures).toBeGreaterThanOrEqual(1);
    expect(row11.post_failures).toBe(0);
    expect(row11.primary_msg_id).toBe('spaces/X/messages/OK');
  });

  it('LLM error → incrementFailure called; processing continues', async () => {
    // 631:12 (K5) processed first via updated_at DESC ordering.
    seedIssue(store, { uid: '631:12', labels: ['K5'], description: 'a', ts: 2000 });
    seedIssue(store, { uid: '631:13', labels: ['BD'], description: 'b', ts: 1000 });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn(async (_path, iid) =>
        makeGitLabIssue({ iid, labels: iid === 12 ? ['K5'] : ['BD'] }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn()
      .mockRejectedValueOnce(new LLMApiError('api_error', 'boom'))
      .mockResolvedValueOnce(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    const summary = await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(summary.errors).toBe(1);
    expect(summary.posted_new).toBe(1);
    const row12 = store.get('631:12');
    expect(row12.post_failures).toBeGreaterThanOrEqual(1);
  });

  it('zero similar closed issues → context still built + LLM still called', async () => {
    seedIssue(store, { uid: '631:14', labels: ['K5'], description: 'cold' });

    const gitlabClient = makeGitlabClient();
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(phase1Fn).toHaveBeenCalledTimes(1);
    const ctx = phase1Fn.mock.calls[0][0];
    expect(Array.isArray(ctx.similar_issues)).toBe(true);
    expect(ctx.similar_issues.length).toBe(0);
  });

  it('actionToken is generated and stored in state', async () => {
    seedIssue(store, { uid: '631:15', labels: ['K5'], description: 'tok' });

    const gitlabClient = makeGitlabClient();
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/X',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
      generateToken: () => 'stable-token-xyz',
    });

    const row = store.get('631:15');
    const stored = JSON.parse(row.last_analysis_json);
    expect(stored.action_token).toBe('stable-token-xyz');
    // posted_hash should equal current hash
    expect(stored.posted_hash).toBe(row.last_analysis_hash);
  });

  it('confidential space override: confidentialSpaceId is used for confidential project', async () => {
    seedIssue(store, {
      uid: '700:16',
      url: 'https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/16',
      labels: ['K5'],
      description: 's',
    });

    const gitlabClient = makeGitlabClient({
      fetchIssue: vi.fn().mockResolvedValue(
        makeGitLabIssue({
          iid: 16,
          labels: ['K5'],
          description: 's',
          web_url: 'https://gitlab.example.com/techcenter/reportcenter_confidential/-/issues/16',
        }),
      ),
    });
    const chatClient = makeChatClient();
    const phase1Fn = vi.fn().mockResolvedValue(makePhase1());
    const phase2Fn = vi.fn().mockResolvedValue(makePhase2());

    await runAnalyzeAndPost({
      stateStore: store,
      gitlabClient,
      chatClient,
      labelConfig: makeLabelConfig(),
      spaceId: 'spaces/MAIN',
      confidentialSpaceId: 'spaces/CONF',
      phase1Fn,
      phase2Fn,
      logger: silentLogger(),
      now: () => 2000,
    });

    expect(chatClient.postCard).toHaveBeenCalledTimes(1);
    const spaceArg = chatClient.postCard.mock.calls[0][0];
    expect(spaceArg).toBe('spaces/CONF');
  });
});
