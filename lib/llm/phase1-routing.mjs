// lib/llm/phase1-routing.mjs — Phase 1 routing LLM: structured tool_use for issue triage.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B2.
//
// Responsibilities:
//   - Build system/user prompts from buildLLMContext output
//   - Call Anthropic Messages API with forced tool_use (route_issue)
//   - Extract + minimally validate the tool input and surface typed errors
//
// Not responsible for:
//   - Retrying on API failures (caller decides policy)
//   - Persisting the result (caller stores via state layer)
//   - Fetching similar_issues or building label_config (Lane A/C)

import Anthropic from '@anthropic-ai/sdk';
import { extractFantiLayers } from './context-builder.mjs';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

/** Required tool input fields (minimal JSON-schema check at runtime). */
const REQUIRED_TOOL_INPUT_FIELDS = [
  'layer',
  'suggested_repos',
  'suggested_assignees',
  'reasoning',
  'confidence',
  'caveats',
];

export const ROUTING_TOOL = {
  name: 'route_issue',
  description: '根據 issue 內容和歷史相似 issue 做路由建議',
  input_schema: {
    type: 'object',
    required: [...REQUIRED_TOOL_INPUT_FIELDS],
    properties: {
      layer: {
        type: 'string',
        description:
          'For Fanti issues: one of crawler | backend | ui | nginx | keypo_integration | unsure. For non-Fanti issues: "n/a".',
      },
      suggested_repos: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 3,
        description: '最多 3 個候選 repos,必須來自 label_config.candidates',
      },
      suggested_assignees: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 3,
        description: '根據歷史 assignee 頻率推薦 2-3 人',
      },
      reasoning: {
        type: 'string',
        description: '1-2 句 zh-TW 解釋路由判斷',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '歷史稀疏或模糊時 < 0.5',
      },
      caveats: {
        type: 'array',
        items: { type: 'string' },
        description: '任何需要提醒 triage 人員的事項',
      },
    },
  },
};

/**
 * Typed LLM error. `.code` is one of:
 *   - 'no_tool_use'   — response did not include a tool_use block
 *   - 'invalid_json'  — tool input missing required fields
 *   - 'timeout'       — surfaced from the SDK (caller-set)
 *   - 'api_error'     — generic SDK/HTTP failure (caller-set)
 */
export class LLMApiError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'LLMApiError';
    this.code = code;
    Object.assign(this, meta);
  }
}

/**
 * Run Phase 1 routing against the Anthropic Messages API.
 * @param {object} context - output of buildLLMContext (new_issue, similar_issues, label_config)
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - falls back to process.env.ANTHROPIC_API_KEY
 * @param {{ messages: { create: Function } }} [opts.client] - injected for tests
 * @returns {Promise<object>} validated tool input (Phase 1 result)
 */
export async function runPhase1Routing(context, { apiKey, client } = {}) {
  const system = buildSystemPrompt(context);
  const user = buildUserPrompt(context);

  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;

  let response;
  if (client) {
    // Injected client (tests) — use as-is.
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [ROUTING_TOOL],
      tool_choice: { type: 'tool', name: 'route_issue' },
      messages: [{ role: 'user', content: user }],
    });
  } else if (resolvedKey) {
    // SDK path (production with API key).
    const sdk = new Anthropic({ apiKey: resolvedKey });
    response = await sdk.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [ROUTING_TOOL],
      tool_choice: { type: 'tool', name: 'route_issue' },
      messages: [{ role: 'user', content: user }],
    });
  } else {
    // CLI fallback (no API key — use the locally logged-in `claude` CLI).
    const { callClaudeCliWithTool } = await import('./cli-fallback.mjs');
    const combinedPrompt = `${system}\n\n${user}`;
    try {
      response = await callClaudeCliWithTool({
        prompt: combinedPrompt,
        toolSchema: ROUTING_TOOL,
        // CLI uses short aliases (e.g. 'sonnet'); 'sonnet-4-6' is not a valid
        // CLI model id even though the Messages API accepts 'claude-sonnet-4-6'.
        model: 'sonnet',
      });
    } catch (err) {
      // Map CLI-specific errors onto our typed LLMApiError taxonomy.
      const code =
        err?.code === 'cli_timeout' ? 'timeout' :
        err?.code === 'cli_schema_mismatch' ? 'invalid_json' :
        err?.code === 'cli_invalid_json' ? 'invalid_json' :
        'api_error';
      throw new LLMApiError(code, `Phase1 CLI fallback: ${err?.message ?? err}`, {
        cliCode: err?.code,
        raw: err?.raw,
      });
    }
  }

  const toolUse = (response?.content ?? []).find(
    (block) => block?.type === 'tool_use' && block?.name === 'route_issue'
  );
  if (!toolUse) {
    throw new LLMApiError('no_tool_use', 'Phase1: no tool_use block in response');
  }

  const input = toolUse.input;
  if (!input || typeof input !== 'object') {
    throw new LLMApiError('invalid_json', 'Phase1: tool_use.input is not an object');
  }
  for (const field of REQUIRED_TOOL_INPUT_FIELDS) {
    if (!(field in input)) {
      throw new LLMApiError(
        'invalid_json',
        `Phase1: tool input missing required field "${field}"`
      );
    }
  }

  return input;
}

// ---- prompt building --------------------------------------------------------

function buildSystemPrompt(context) {
  const fantiLayers = extractFantiLayers(context?.label_config);
  const hasFanti = (context?.new_issue?.labels ?? []).includes('Fanti');

  const layerGuidance = hasFanti && fantiLayers
    ? [
        '- 如果 issue 帶有 Fanti label,必須從以下 layer enum 選一個:',
        ...Object.keys(fantiLayers).map((k) => `    * ${k}`),
        '    * unsure (資訊不足時使用)',
      ].join('\n')
    : '- 如果 issue 沒有 Fanti label,layer 必須填 "n/a"。';

  return [
    '你是一個工程 team 的 GitLab issue triage 助理。',
    '你的工作是根據新 issue 的內容,加上少量相似歷史 issue,做路由建議 (suggested repos + assignees) 並給一個 0.0-1.0 的信心分數。',
    '',
    '重要規則:',
    '- suggested_repos 只能從 label_config 中該 label 的 candidates / layers 列表挑選,絕對不要發明不存在的 repo。',
    layerGuidance,
    '- 若歷史 issue 稀疏、資訊不足,或是冷啟動 (cold start),confidence 必須 < 0.5,並把理由放進 caveats。',
    '- reasoning 用 1-2 句繁體中文 (zh-TW) 說明判斷依據。',
    '- caveats 列出任何 triage 人員應該要注意的不確定性 (例如: "歷史只有 1 筆相似 issue")。',
    '- suggested_assignees 用過去實際處理過類似 issue 的人員 username (最多 3 個)。',
    '',
    '請用 route_issue tool 回傳結構化結果。',
  ].join('\n');
}

function buildUserPrompt(ctx) {
  const { new_issue, similar_issues = [], label_config } = ctx;

  const labelsLine = (new_issue.labels || []).join(', ') || '(none)';
  const newIssueBlock = [
    '=== NEW ISSUE ===',
    `Title: ${new_issue.title}`,
    `Labels: ${labelsLine}`,
    `Project: ${new_issue.project_path ?? '(unknown)'}`,
    'Description:',
    new_issue.description ?? '',
  ].join('\n');

  const labelConfigBlock = [
    '=== LABEL CONFIG ===',
    JSON.stringify(label_config, null, 2),
  ].join('\n');

  let similarBlock;
  if (!similar_issues || similar_issues.length === 0) {
    similarBlock = '=== SIMILAR PAST ISSUES ===\nNO SIMILAR ISSUES FOUND — cold start. Set confidence ≤ 0.5.';
  } else {
    const entries = similar_issues.map((s, i) => {
      const lbls = (s.labels || []).join(', ') || '(none)';
      const hint = s.resolution_hint ? `\nResolution hint: ${s.resolution_hint}` : '';
      return [
        `[${i + 1}] #${s.iid} "${s.title}"`,
        `Labels: ${lbls}`,
        `Assignee: ${s.assignee ?? '(none)'}`,
        `Closing excerpt: ${s.closing_excerpt ?? ''}${hint}`,
      ].join('\n');
    });
    similarBlock = ['=== SIMILAR PAST ISSUES ===', entries.join('\n---\n')].join('\n');
  }

  return [
    newIssueBlock,
    '',
    labelConfigBlock,
    '',
    similarBlock,
    '',
    '請 invoke route_issue tool 回傳你的結構化建議。',
  ].join('\n');
}
