// test/unit/llm/phase2-plan.test.mjs — unit tests for Phase 2 plan generation LLM.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B3.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runPhase2Plan,
  PLAN_TOOL,
} from '../../../lib/llm/phase2-plan.mjs';
import { LLMApiError } from '../../../lib/llm/phase1-routing.mjs';

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

const highConfidencePhase1 = (overrides = {}) => ({
  layer: 'n/a',
  suggested_repos: ['techcenter/reportcenter'],
  suggested_assignees: ['alice', 'bob'],
  reasoning: '根據歷史類似 issue,問題在 reportcenter 匯出模組。',
  confidence: 0.8,
  caveats: [],
  ...overrides,
});

const validPlanInput = () => ({
  summary: '使用者匯出 CSV 時出現 500 錯誤,類似過去的 export 模組問題。建議從 export.py 檢查。影響範圍為 reportcenter 使用者。',
  plan_draft: [
    '檢查 export.py 的 CSV 生成邏輯是否處理空值',
    '在 staging 重現 500 錯誤並抓 stack trace',
    '針對重現條件寫 regression test',
    '實作修正並 review',
    '部署後驗證使用者匯出流程',
  ],
  risks: [
    '修改 CSV 生成可能影響其他匯出格式(Excel / PDF)',
    '部署後需監控 error rate 30 分鐘,異常需 rollback',
  ],
});

function makeMockClient(toolInput = validPlanInput()) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'generate_plan', input: toolInput },
        ],
      }),
    },
  };
}

describe('PLAN_TOOL schema', () => {
  it('has expected name, description, and required fields', () => {
    expect(PLAN_TOOL.name).toBe('generate_plan');
    expect(PLAN_TOOL.description).toMatch(/plan/);
    expect(PLAN_TOOL.input_schema.required).toEqual(['summary', 'plan_draft', 'risks']);
    const props = PLAN_TOOL.input_schema.properties;
    expect(props.summary.type).toBe('string');
    expect(props.plan_draft.type).toBe('array');
    expect(props.plan_draft.items.type).toBe('string');
    expect(props.plan_draft.maxItems).toBe(5);
    expect(props.risks.type).toBe('array');
    expect(props.risks.items.type).toBe('string');
    expect(props.risks.maxItems).toBe(3);
  });
});

describe('runPhase2Plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skip path: confidence 0.3 → returns summary+plan_draft:null WITHOUT calling LLM', async () => {
    const client = makeMockClient();
    const phase1 = highConfidencePhase1({ confidence: 0.3, reasoning: '資訊不足,歷史只有 1 筆模糊 issue。' });
    const result = await runPhase2Plan(baseContext(), phase1, { client });
    expect(result).toEqual({ summary: '資訊不足,歷史只有 1 筆模糊 issue。', plan_draft: null });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('strict boundary: confidence exactly 0.5 DOES call the LLM (strict <, not <=)', async () => {
    const client = makeMockClient();
    const phase1 = highConfidencePhase1({ confidence: 0.5 });
    await runPhase2Plan(baseContext(), phase1, { client });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('happy path: confidence 0.8 → returns tool_use input', async () => {
    const client = makeMockClient();
    const result = await runPhase2Plan(baseContext(), highConfidencePhase1(), { client });
    expect(result).toEqual(validPlanInput());
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('calls client.messages.create with model claude-sonnet-4-6 and correct tool_choice', async () => {
    const client = makeMockClient();
    await runPhase2Plan(baseContext(), highConfidencePhase1(), { client });
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        tools: expect.arrayContaining([expect.objectContaining({ name: 'generate_plan' })]),
        tool_choice: { type: 'tool', name: 'generate_plan' },
        max_tokens: expect.any(Number),
      })
    );
  });

  it('prompt contains all 3 similar issue excerpts when provided', async () => {
    const client = makeMockClient();
    const similar = [
      {
        iid: 101,
        title: '舊的匯出錯誤 A',
        labels: ['K5'],
        assignee: 'alice',
        closing_excerpt: '獨特_摘要_AAA_修復 CSV encoding',
        resolution_hint: 'fix in export.py',
      },
      {
        iid: 102,
        title: '舊的匯出錯誤 B',
        labels: ['K5'],
        assignee: 'bob',
        closing_excerpt: '獨特_摘要_BBB_處理空值',
      },
      {
        iid: 103,
        title: '舊的匯出錯誤 C',
        labels: ['K5'],
        assignee: 'alice',
        closing_excerpt: '獨特_摘要_CCC_timeout 調整',
      },
    ];
    await runPhase2Plan(baseContext({ similar_issues: similar }), highConfidencePhase1(), { client });
    const call = client.messages.create.mock.calls[0][0];
    const user = call.messages.find((m) => m.role === 'user').content;
    expect(user).toContain('獨特_摘要_AAA_修復 CSV encoding');
    expect(user).toContain('獨特_摘要_BBB_處理空值');
    expect(user).toContain('獨特_摘要_CCC_timeout 調整');
  });

  it('missing tool_use block → throws LLMApiError with code "no_tool_use"', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '對不起我不知道該怎麼做' }],
        }),
      },
    };
    const err = await runPhase2Plan(baseContext(), highConfidencePhase1(), { client }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMApiError);
    expect(err.code).toBe('no_tool_use');
  });

  it('missing plan_draft field in tool input → throws LLMApiError with code "invalid_json"', async () => {
    const bad = { ...validPlanInput() };
    delete bad.plan_draft;
    const client = makeMockClient(bad);
    const err = await runPhase2Plan(baseContext(), highConfidencePhase1(), { client }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMApiError);
    expect(err.code).toBe('invalid_json');
  });

  it('cold start: zero similar_issues but confidence >= 0.5 → prompt acknowledges lack of history', async () => {
    const client = makeMockClient();
    await runPhase2Plan(baseContext({ similar_issues: [] }), highConfidencePhase1({ confidence: 0.6 }), { client });
    const call = client.messages.create.mock.calls[0][0];
    const user = call.messages.find((m) => m.role === 'user').content;
    // Some signal that history is absent — e.g. "NO SIMILAR", "無相似", "cold start", or similar.
    expect(user).toMatch(/NO SIMILAR|無相似|cold start|沒有相似|no similar/i);
  });

  it('prompt contains Phase 1 reasoning so Phase 2 sees routing rationale', async () => {
    const client = makeMockClient();
    const phase1 = highConfidencePhase1({
      reasoning: '獨特_P1_REASONING_XYZ 匯出模組歷史問題。',
      suggested_repos: ['techcenter/reportcenter'],
      suggested_assignees: ['alice'],
      layer: 'n/a',
    });
    await runPhase2Plan(baseContext(), phase1, { client });
    const call = client.messages.create.mock.calls[0][0];
    const system = call.system || '';
    const user = call.messages.find((m) => m.role === 'user').content;
    const combined = `${system}\n${user}`;
    expect(combined).toContain('獨特_P1_REASONING_XYZ');
    expect(combined).toContain('techcenter/reportcenter');
    expect(combined).toContain('alice');
  });

  it('prompt includes PII-avoidance instruction', async () => {
    const client = makeMockClient();
    await runPhase2Plan(baseContext(), highConfidencePhase1(), { client });
    const call = client.messages.create.mock.calls[0][0];
    const system = call.system || '';
    const user = call.messages.find((m) => m.role === 'user').content;
    const combined = `${system}\n${user}`;
    // Explicit rule about not echoing PII (客戶名 / email / 電話 etc.)
    expect(combined).toMatch(/PII|客戶名|email|電話/);
    expect(combined).toMatch(/不.*echo|不要.*引用|不要.*複製|避免.*輸出|不.*輸出/);
  });

  it('prompt includes executable-step rule (no vague verbs like 確認一下 / 看看)', async () => {
    const client = makeMockClient();
    await runPhase2Plan(baseContext(), highConfidencePhase1(), { client });
    const call = client.messages.create.mock.calls[0][0];
    const system = call.system || '';
    const user = call.messages.find((m) => m.role === 'user').content;
    const combined = `${system}\n${user}`;
    expect(combined).toMatch(/確認一下|看看|可執行|工程步驟/);
  });

  it('prompt asks the model to produce risks (regression / rollout concerns)', async () => {
    const client = makeMockClient();
    await runPhase2Plan(baseContext(), highConfidencePhase1(), { client });
    const call = client.messages.create.mock.calls[0][0];
    const system = call.system || '';
    const user = call.messages.find((m) => m.role === 'user').content;
    const combined = `${system}\n${user}`;
    expect(combined).toMatch(/risks|風險|回歸|rollback|副作用|影響範圍/);
  });

  it('missing risks field in tool input → throws LLMApiError with code "invalid_json"', async () => {
    const bad = validPlanInput();
    delete bad.risks;
    const client = makeMockClient(bad);
    await expect(
      runPhase2Plan(baseContext(), highConfidencePhase1(), { client })
    ).rejects.toMatchObject({ name: 'LLMApiError', code: 'invalid_json' });
  });

  it('uses provided client and does NOT instantiate Anthropic SDK (no ANTHROPIC_API_KEY needed)', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = makeMockClient();
      await expect(
        runPhase2Plan(baseContext(), highConfidencePhase1(), { client })
      ).resolves.toBeDefined();
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
