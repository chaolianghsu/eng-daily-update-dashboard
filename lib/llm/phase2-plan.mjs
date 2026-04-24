// lib/llm/phase2-plan.mjs — Phase 2 plan generation LLM: summary + plan draft for triage cards.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B3.
//
// Responsibilities:
//   - Gate on Phase 1 confidence: < 0.5 short-circuits to { summary, plan_draft: null }
//   - Build prompt that reuses Phase 1 routing rationale (so Phase 2 doesn't re-route)
//   - Call Anthropic Messages API with forced tool_use (generate_plan)
//   - Enforce PII avoidance + executable-step rules in the prompt
//
// Not responsible for:
//   - Retrying on API failures (caller decides policy)
//   - Persisting the result (caller stores via state layer)
//   - Deciding whether to post the Chat card (orchestration layer)

import Anthropic from '@anthropic-ai/sdk';
import { LLMApiError } from './phase1-routing.mjs';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const CONFIDENCE_THRESHOLD = 0.5;

/** Required tool input fields (minimal JSON-schema check at runtime). */
const REQUIRED_TOOL_INPUT_FIELDS = ['summary', 'plan_draft', 'risks'];

export const PLAN_TOOL = {
  name: 'generate_plan',
  description: '根據 issue 和過去解法 pattern 生 plan draft',
  input_schema: {
    type: 'object',
    required: [...REQUIRED_TOOL_INPUT_FIELDS],
    properties: {
      summary: {
        type: 'string',
        description: '3-5 句 zh-TW 摘要',
      },
      plan_draft: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 5,
        description: '3-5 條實作步驟',
      },
      risks: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 3,
        description: '1-3 條上線前後的風險 / 回歸可能 / 監控點 / rollback 條件',
      },
    },
  },
};

/**
 * Run Phase 2 plan generation.
 *
 * If `phase1Result.confidence < 0.5`, returns immediately WITHOUT calling the LLM,
 * using Phase 1 reasoning as the summary and null plan_draft (low-confidence skip path).
 *
 * @param {object} context - output of buildLLMContext (new_issue, similar_issues, label_config)
 * @param {object} phase1Result - output of runPhase1Routing (must include confidence + reasoning)
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - falls back to process.env.ANTHROPIC_API_KEY
 * @param {{ messages: { create: Function } }} [opts.client] - injected for tests
 * @returns {Promise<{ summary: string, plan_draft: string[] | null }>}
 */
export async function runPhase2Plan(context, phase1Result, { apiKey, client, cliFallback } = {}) {
  if (!phase1Result || typeof phase1Result !== 'object') {
    throw new LLMApiError('invalid_json', 'Phase2: phase1Result must be an object');
  }

  if (phase1Result.confidence < CONFIDENCE_THRESHOLD) {
    return { summary: phase1Result.reasoning ?? '', plan_draft: null };
  }

  const system = buildSystemPrompt();
  const user = buildUserPrompt(context, phase1Result);

  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;

  let response;
  if (client) {
    // Injected client (tests) — use as-is.
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'generate_plan' },
      messages: [{ role: 'user', content: user }],
    });
  } else if (resolvedKey) {
    // SDK path.
    const sdk = new Anthropic({ apiKey: resolvedKey });
    response = await sdk.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'generate_plan' },
      messages: [{ role: 'user', content: user }],
    });
  } else {
    // CLI fallback. Uses retry+backoff by default so a transient rate-limit
    // exit 1 does not abort a whole eval run.
    const call = cliFallback ?? (await getDefaultCliFallback());
    const combinedPrompt = `${system}\n\n${user}`;
    try {
      response = await call({
        prompt: combinedPrompt,
        toolSchema: PLAN_TOOL,
        // CLI uses short aliases; 'sonnet-4-6' is not a valid CLI model id.
        model: 'sonnet',
      });
    } catch (err) {
      const code =
        err?.code === 'cli_timeout' ? 'timeout' :
        err?.code === 'cli_schema_mismatch' ? 'invalid_json' :
        err?.code === 'cli_invalid_json' ? 'invalid_json' :
        'api_error';
      throw new LLMApiError(code, `Phase2 CLI fallback: ${err?.message ?? err}`, {
        cliCode: err?.code,
        raw: err?.raw,
      });
    }
  }

  const toolUse = (response?.content ?? []).find(
    (block) => block?.type === 'tool_use' && block?.name === 'generate_plan'
  );
  if (!toolUse) {
    throw new LLMApiError('no_tool_use', 'Phase2: no tool_use block in response');
  }

  const input = toolUse.input;
  if (!input || typeof input !== 'object') {
    throw new LLMApiError('invalid_json', 'Phase2: tool_use.input is not an object');
  }
  for (const field of REQUIRED_TOOL_INPUT_FIELDS) {
    if (!(field in input)) {
      throw new LLMApiError(
        'invalid_json',
        `Phase2: tool input missing required field "${field}"`
      );
    }
  }

  return input;
}

async function getDefaultCliFallback() {
  const { callClaudeCliWithToolRetrying } = await import('./cli-fallback.mjs');
  return (args) =>
    callClaudeCliWithToolRetrying({
      ...args,
      maxAttempts: 3,
      baseDelayMs: 30_000,
      maxDelayMs: 120_000,
    });
}

// ---- prompt building --------------------------------------------------------

function buildSystemPrompt() {
  return [
    '你是一個工程 team 的 GitLab issue triage 助理,負責根據已經決定好的路由結果,產一份簡短的 summary 與可執行的 plan draft 草稿,讓接手的工程師能快速上手。',
    '',
    '重要規則:',
    '- summary 必須是 3-5 句繁體中文 (zh-TW),點出問題、影響範圍、可能方向。',
    '- plan_draft 必須是 3-5 條「可執行的工程步驟」,每一步都要有明確動作 (檢查 / 實作 / 新增 / 重現 / 寫測試 / 部署 / 驗證...)。',
    '- 嚴禁使用「確認一下」「看看」「研究一下」這種模糊動詞 — 必須是具體工程動作。',
    '- risks 列 1-3 條「上線風險 / 回歸可能 / 需監控的指標 / rollback 條件」,針對這次改動的副作用或 blast radius 提醒:',
    '    * 修這裡會不會連帶影響其他功能或 repo?',
    '    * 要觀察哪個 metric 來判斷是否要 rollback?(error rate / 特定使用者流量 / 下游系統)',
    '    * 有沒有無法在開發環境重現的邊界條件 (時區 / 客戶規模 / concurrency)?',
    '  不要寫「沒有風險」這種話 — 如果真的很小就說「影響範圍僅 X,監控 error rate 即可」。',
    '- 路由已在 Phase 1 決定,不要重新推薦 repo 或 assignee,只負責生 summary + plan_draft + risks。',
    '',
    '保密與 PII 規則 (非常重要):',
    '- 不要 echo description 中的 PII —— 包括客戶名、email、電話、身分證號、帳號、IP、token 等。',
    '- 如果要引用,就用抽象描述 (例如「某個客戶」「某筆訂單」),不要複製原文。',
    '- 不要輸出任何看起來像密鑰、secret、憑證的字串。',
    '',
    '請用 generate_plan tool 回傳結構化結果。',
  ].join('\n');
}

function buildUserPrompt(ctx, phase1) {
  const { new_issue, similar_issues = [] } = ctx;

  const labelsLine = (new_issue.labels || []).join(', ') || '(none)';
  const newIssueBlock = [
    '=== NEW ISSUE ===',
    `Title: ${new_issue.title}`,
    `Labels: ${labelsLine}`,
    `Project: ${new_issue.project_path ?? '(unknown)'}`,
    'Description:',
    new_issue.description ?? '',
  ].join('\n');

  const phase1Block = [
    '=== PHASE 1 ROUTING RESULT (已決定,不要覆寫) ===',
    `Layer: ${phase1.layer ?? 'n/a'}`,
    `Suggested repos: ${(phase1.suggested_repos || []).join(', ') || '(none)'}`,
    `Suggested assignees: ${(phase1.suggested_assignees || []).join(', ') || '(none)'}`,
    `Confidence: ${phase1.confidence}`,
    `Reasoning: ${phase1.reasoning ?? ''}`,
    `Caveats: ${(phase1.caveats || []).join('; ') || '(none)'}`,
  ].join('\n');

  let similarBlock;
  if (!similar_issues || similar_issues.length === 0) {
    similarBlock = [
      '=== SIMILAR PAST ISSUES ===',
      'NO SIMILAR ISSUES FOUND — cold start,沒有相似的歷史 issue 可參考。',
      '請根據 new issue 的 description 與 Phase 1 路由建議,謹慎產出通用的 plan draft。',
    ].join('\n');
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
    phase1Block,
    '',
    similarBlock,
    '',
    '請根據以上資訊,產出:',
    '1) 3-5 句 zh-TW summary (不要 echo description 的 PII / 客戶名 / email / 電話)',
    '2) 3-5 條可執行的工程步驟 plan_draft (不要出現「確認一下」「看看」這種模糊動詞)',
    '3) 1-3 條 risks (副作用 / 回歸風險 / 監控點 / rollback 條件)',
    '',
    '請 invoke generate_plan tool 回傳你的結構化建議。',
  ].join('\n');
}
