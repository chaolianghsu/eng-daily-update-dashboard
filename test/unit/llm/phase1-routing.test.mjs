// test/unit/llm/phase1-routing.test.mjs — unit tests for Phase 1 routing LLM.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B2.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runPhase1Routing,
  LLMApiError,
  ROUTING_TOOL,
  renderRepoNotes,
} from '../../../lib/llm/phase1-routing.mjs';

const baseConfig = () => ({
  labels: {
    K5: { primary_group: 'techcenter/reportcenter', candidates: ['techcenter/reportcenter'] },
    Fanti: {
      primary_group: null,
      layers: {
        crawler: ['CrawlersV2/fanti-scraper'],
        backend: ['bigdata/fanti-api'],
        ui: ['dailyview/fanti-ui'],
        nginx: ['infra/nginx-configs'],
        keypo_integration: ['bigdata/keypo-bridge'],
      },
    },
  },
  ignore_for_routing: ['P1_高', 'P2_中'],
});

const baseContext = (overrides = {}) => ({
  new_issue: {
    id: 12345,
    project_path: 'techcenter/reportcenter',
    title: '報表匯出失敗',
    description: '使用者點擊匯出 CSV 時出現 500 錯誤。',
    labels: ['K5', 'P1_高'],
    ...(overrides.new_issue || {}),
  },
  similar_issues: overrides.similar_issues ?? [],
  label_config: overrides.label_config ?? baseConfig(),
});

const validToolInput = () => ({
  layer: 'n/a',
  suggested_repos: ['techcenter/reportcenter'],
  suggested_assignees: ['alice'],
  reasoning: '根據歷史類似 issue,問題在 reportcenter 匯出模組。',
  confidence: 0.8,
  caveats: [],
});

function makeMockClient(toolInput = validToolInput(), extra = {}) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'route_issue', input: toolInput, ...extra },
        ],
      }),
    },
  };
}

describe('ROUTING_TOOL schema', () => {
  it('has expected name, description, and required fields', () => {
    expect(ROUTING_TOOL.name).toBe('route_issue');
    expect(ROUTING_TOOL.description).toMatch(/issue/);
    expect(ROUTING_TOOL.input_schema.required).toEqual([
      'layer',
      'suggested_repos',
      'suggested_assignees',
      'reasoning',
      'confidence',
      'caveats',
    ]);
    const props = ROUTING_TOOL.input_schema.properties;
    expect(props.suggested_repos.maxItems).toBe(3);
    expect(props.suggested_assignees.maxItems).toBe(3);
    expect(props.confidence.minimum).toBe(0);
    expect(props.confidence.maximum).toBe(1);
  });
});

describe('runPhase1Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns the tool_use input when the mock responds with valid data', async () => {
    const client = makeMockClient();
    const result = await runPhase1Routing(baseContext(), { client });
    expect(result).toEqual(validToolInput());
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('calls client.messages.create with expected model/tools/tool_choice/max_tokens', async () => {
    const client = makeMockClient();
    await runPhase1Routing(baseContext(), { client });
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        tools: expect.arrayContaining([expect.objectContaining({ name: 'route_issue' })]),
        tool_choice: { type: 'tool', name: 'route_issue' },
        max_tokens: expect.any(Number),
      })
    );
  });

  it('throws LLMApiError with code "no_tool_use" when no tool_use block is returned', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '對不起我不知道該怎麼做' }],
        }),
      },
    };
    await expect(runPhase1Routing(baseContext(), { client })).rejects.toMatchObject({
      name: 'LLMApiError',
      code: 'no_tool_use',
    });
  });

  it('throws LLMApiError with code "invalid_json" when a required field is missing', async () => {
    const badInput = { ...validToolInput() };
    delete badInput.confidence;
    const client = makeMockClient(badInput);
    await expect(runPhase1Routing(baseContext(), { client })).rejects.toMatchObject({
      name: 'LLMApiError',
      code: 'invalid_json',
    });
  });

  it('prompt contains "NO SIMILAR ISSUES FOUND" when similar_issues is empty', async () => {
    const client = makeMockClient();
    await runPhase1Routing(baseContext({ similar_issues: [] }), { client });
    const call = client.messages.create.mock.calls[0][0];
    const userMessage = call.messages.find((m) => m.role === 'user').content;
    expect(userMessage).toMatch(/NO SIMILAR ISSUES FOUND/);
  });

  it('cold-start prompt must NOT hard-cap confidence (prior bug)', async () => {
    // Step 2f regression: "Set confidence ≤ 0.5" on cold-start forced every
    // fixture to conf ≤ 0.5, which in turn gated Phase 2 and inflated ECE.
    // Cold-start should be a soft signal, not a cap.
    const client = makeMockClient();
    await runPhase1Routing(baseContext({ similar_issues: [] }), { client });
    const call = client.messages.create.mock.calls[0][0];
    const userMessage = call.messages.find((m) => m.role === 'user').content;
    expect(userMessage).not.toMatch(/confidence\s*[≤<]=?\s*0\.5/i);
    expect(userMessage).not.toMatch(/Set confidence\s*[≤<]/i);
  });

  it('prompt includes excerpt text from similar_issues when non-empty', async () => {
    const client = makeMockClient();
    const similar = [
      {
        iid: 100,
        title: '舊的匯出錯誤',
        labels: ['K5'],
        assignee: 'alice',
        closing_excerpt: '已修復匯出模組的特定錯誤訊息',
        resolution_hint: 'fix in export.py',
      },
    ];
    await runPhase1Routing(baseContext({ similar_issues: similar }), { client });
    const call = client.messages.create.mock.calls[0][0];
    const userMessage = call.messages.find((m) => m.role === 'user').content;
    expect(userMessage).toContain('已修復匯出模組的特定錯誤訊息');
    expect(userMessage).toContain('#100');
    expect(userMessage).toContain('alice');
    expect(userMessage).not.toMatch(/NO SIMILAR ISSUES FOUND/);
  });

  it('prompt mentions Fanti layer enum when Fanti label is present', async () => {
    const client = makeMockClient({
      ...validToolInput(),
      layer: 'backend',
      suggested_repos: ['bigdata/fanti-api'],
    });
    const ctx = baseContext({
      new_issue: {
        id: 1,
        project_path: 'bigdata/fanti-api',
        title: 'Fanti API 500',
        description: 'Fanti backend timeout',
        labels: ['Fanti'],
      },
    });
    await runPhase1Routing(ctx, { client });
    const call = client.messages.create.mock.calls[0][0];
    const system = call.system || '';
    const user = call.messages.find((m) => m.role === 'user').content;
    const combined = `${system}\n${user}`;
    expect(combined).toMatch(/crawler/);
    expect(combined).toMatch(/backend/);
    expect(combined).toMatch(/ui/);
    expect(combined).toMatch(/nginx/);
    expect(combined).toMatch(/keypo_integration/);
  });

  it('prompt describes layer as "n/a" when non-Fanti label', async () => {
    const client = makeMockClient();
    const ctx = baseContext({
      new_issue: {
        id: 2,
        project_path: 'techcenter/reportcenter',
        title: 'K5 報表問題',
        description: '匯出失敗',
        labels: ['K5'],
      },
    });
    await runPhase1Routing(ctx, { client });
    const call = client.messages.create.mock.calls[0][0];
    const system = call.system || '';
    const user = call.messages.find((m) => m.role === 'user').content;
    const combined = `${system}\n${user}`;
    expect(combined).toMatch(/n\/a/);
  });

  it('injects REPO NOTES block when repo_descriptions matches issue labels', async () => {
    const client = makeMockClient();
    const cfg = baseConfig();
    cfg.labels.K5 = {
      primary_group: 'KEYPO',
      known_exceptions: ['KEYPO/keypo-backend', 'KEYPO/keypo-engine-api'],
    };
    cfg.repo_descriptions = {
      'KEYPO/keypo-backend': '主 API / 後台 server。處理 user / 速報 / 推播。',
      'KEYPO/keypo-engine-api': '資料查詢引擎對外 API。探索概念 / 海外查詢。',
      'dailyview/unrelated': '不該出現的 repo。',
    };
    await runPhase1Routing(baseContext({ label_config: cfg }), { client });
    const user = client.messages.create.mock.calls[0][0].messages[0].content;
    expect(user).toContain('=== REPO NOTES');
    expect(user).toContain('KEYPO/keypo-backend');
    expect(user).toContain('KEYPO/keypo-engine-api');
    // Unrelated repo (no matching label) must not leak in
    expect(user).not.toContain('dailyview/unrelated');
    // And the raw JSON LABEL CONFIG dump must NOT include repo_descriptions
    // (avoid a giant blob of all repos in the model's context)
    expect(user).not.toContain('"repo_descriptions"');
  });

  it('omits REPO NOTES block when repo_descriptions is absent', async () => {
    const client = makeMockClient();
    await runPhase1Routing(baseContext(), { client });
    const user = client.messages.create.mock.calls[0][0].messages[0].content;
    // The "=== REPO NOTES" block header should not appear; the phrase
    // "REPO NOTES" may still appear inside the cold-start soft note.
    expect(user).not.toContain('=== REPO NOTES');
  });

  it('renderRepoNotes scopes candidates to labels on the issue', () => {
    const cfg = {
      labels: {
        K5: { primary_group: 'KEYPO', known_exceptions: ['KEYPO/keypo-backend'] },
        BD: { primary_group: 'bigdata', known_exceptions: ['bigdata/etl'] },
      },
      repo_descriptions: {
        'KEYPO/keypo-backend': 'backend',
        'bigdata/etl': 'etl',
      },
    };
    const out = renderRepoNotes(cfg, { labels: ['K5'] });
    expect(out).toContain('KEYPO/keypo-backend');
    expect(out).not.toContain('bigdata/etl');
  });

  it('renderRepoNotes returns empty string when no matching descriptions', () => {
    const cfg = {
      labels: { K5: { primary_group: 'KEYPO', known_exceptions: ['KEYPO/foo'] } },
      repo_descriptions: { 'other/repo': 'x' },
    };
    expect(renderRepoNotes(cfg, { labels: ['K5'] })).toBe('');
  });

  it('system prompt instructs model to use REPO NOTES for top-1 choice', async () => {
    const client = makeMockClient();
    await runPhase1Routing(baseContext(), { client });
    const sys = client.messages.create.mock.calls[0][0].system;
    expect(sys).toContain('REPO NOTES');
    expect(sys).toMatch(/top-1/i);
  });

  it('uses provided client and does NOT instantiate Anthropic SDK', async () => {
    // If this test passes even without ANTHROPIC_API_KEY set, it confirms
    // that the injected client is used and no real SDK constructor is hit.
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = makeMockClient();
      await expect(runPhase1Routing(baseContext(), { client })).resolves.toBeDefined();
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  it('calls injected cliFallback when no client and no apiKey (retry wrapper plumb point)', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const cliFallback = vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'route_issue', input: validToolInput() },
        ],
      });
      const result = await runPhase1Routing(baseContext(), { cliFallback });
      expect(cliFallback).toHaveBeenCalledTimes(1);
      const args = cliFallback.mock.calls[0][0];
      expect(args.toolSchema).toBe(ROUTING_TOOL);
      expect(args.prompt).toContain('issue');
      expect(args.model).toBe('sonnet');
      expect(result.suggested_repos).toEqual(['techcenter/reportcenter']);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  it('overrides suggested_assignees with config default_assignees for issue labels', async () => {
    // LLM's output is discarded for assignees — config is authoritative.
    // Reason: GitLab clears assignee on close, so historical inference is
    // pointless. Policy lives in label-routing.yaml.
    const cfg = baseConfig();
    cfg.labels.K5.default_assignees = ['Joyce'];
    cfg.labels.Data = { primary_group: 'Crawlers', default_assignees: ['Walt'] };
    const client = makeMockClient(validToolInput()); // LLM suggests 'alice'

    const result = await runPhase1Routing(
      baseContext({
        new_issue: { labels: ['K5', 'P1_高'], project_path: 'KEYPO/keypo-backend' },
        label_config: cfg,
      }),
      { client },
    );
    expect(result.suggested_assignees).toEqual(['Joyce']);
  });

  it('unions default_assignees from multiple labels, dedups, caps at 3', async () => {
    const cfg = baseConfig();
    cfg.labels.K5.default_assignees = ['Joyce', 'Shared'];
    cfg.labels.Data = { primary_group: 'Crawlers', default_assignees: ['Walt', 'Shared'] };
    const client = makeMockClient(validToolInput());

    const result = await runPhase1Routing(
      baseContext({
        new_issue: { labels: ['K5', 'Data'] },
        label_config: cfg,
      }),
      { client },
    );
    expect(result.suggested_assignees.length).toBeLessThanOrEqual(3);
    expect(new Set(result.suggested_assignees)).toEqual(new Set(['Joyce', 'Shared', 'Walt']));
  });

  it('keeps LLM suggested_assignees when no label has default_assignees', async () => {
    const client = makeMockClient(validToolInput()); // alice
    const result = await runPhase1Routing(baseContext(), { client });
    expect(result.suggested_assignees).toEqual(['alice']);
  });

  it('system prompt contains concrete confidence anchors and at least one example', async () => {
    const client = makeMockClient();
    await runPhase1Routing(baseContext(), { client });
    const sys = client.messages.create.mock.calls[0][0].system;
    // Anchors present for 0.85-0.95 and < 0.5 buckets
    expect(sys).toMatch(/0\.85[^0-9]/);
    expect(sys).toMatch(/0\.9/);
    expect(sys).toMatch(/<\s?0\.5/);
    // Worked example — a concrete scenario mapped to a concrete confidence
    expect(sys).toMatch(/範例/);
    // Caveats must not be framed as a confidence down-modifier
    expect(sys).not.toMatch(/不要用「我不太確定」/);
    expect(sys).toMatch(/caveats.*(沒有|空陣列|\[\])/);
  });

  it('maps cliFallback cli_error to LLMApiError code api_error', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const rateLimitErr = Object.assign(new Error('claude CLI exited 1: '), {
        code: 'cli_error',
        exitCode: 1,
      });
      const cliFallback = vi.fn().mockRejectedValue(rateLimitErr);
      const err = await runPhase1Routing(baseContext(), { cliFallback })
        .catch((e) => e);
      expect(err).toBeInstanceOf(LLMApiError);
      expect(err.code).toBe('api_error');
      expect(err.cliCode).toBe('cli_error');
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
