// test/unit/llm/phase1-routing.test.mjs — unit tests for Phase 1 routing LLM.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B2.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runPhase1Routing,
  LLMApiError,
  ROUTING_TOOL,
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
});
