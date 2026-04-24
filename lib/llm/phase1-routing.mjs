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
 * @param {(args:{prompt:string, toolSchema:object, model:string}) => Promise<object>} [opts.cliFallback]
 *   - injected CLI fallback (tests). Defaults to `callClaudeCliWithToolRetrying`
 *     with rate-limit-friendly backoff (30s → 120s).
 * @returns {Promise<object>} validated tool input (Phase 1 result)
 */
export async function runPhase1Routing(context, { apiKey, client, cliFallback } = {}) {
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
    // Uses retry+backoff by default so a transient rate-limit exit 1 does not
    // abort a whole eval run.
    const call = cliFallback ?? (await getDefaultCliFallback());
    const combinedPrompt = `${system}\n\n${user}`;
    try {
      response = await call({
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

  // Override suggested_assignees with config-defined defaults when any of the
  // issue's labels has `default_assignees`. GitLab clears assignee on close, so
  // historical LLM inference can't be evaluated against ground truth — the
  // label-routing.yaml policy is the source of truth for assignees.
  const configuredAssignees = collectDefaultAssignees(
    context?.label_config,
    context?.new_issue?.labels ?? []
  );
  if (configuredAssignees.length > 0) {
    input.suggested_assignees = configuredAssignees.slice(0, 3);
  }

  return input;
}

/**
 * Collect `default_assignees` from the label config for any of the issue's
 * labels, de-duplicated in first-seen order.
 */
export function collectDefaultAssignees(labelConfig, issueLabels) {
  const out = [];
  const seen = new Set();
  for (const label of issueLabels ?? []) {
    const defaults = labelConfig?.labels?.[label]?.default_assignees ?? [];
    for (const a of defaults) {
      if (typeof a !== 'string' || !a.trim()) continue;
      if (seen.has(a)) continue;
      seen.add(a);
      out.push(a);
    }
  }
  return out;
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
    '- suggested_repos 第一個必須是「最可能是 root-cause / fix-target 的 repo」,不是「最相關的所有 repo 隨便排」。請根據 REPO NOTES 的分工描述判斷 issue 症狀對應到哪個 repo 的職責,再決定 top-1。',
    layerGuidance,
    '- confidence 是「基於 REPO NOTES 匹配強度」的機率,不是「我謙虛與否」的表態:',
    '    * 定位方式:看 issue 描述的關鍵術語能不能對上某個 repo 在 REPO NOTES 裡的職責敘述。匹配越具體,信心越高。',
    '    * 0.85 - 0.95:issue 描述的核心症狀/功能名直接命中某 repo 的 REPO NOTES 關鍵字(例如「聲量不足/AI 報告分析錯誤」對到 engine-api、「帳號到期/排程寄送」對到 keypo-backend、「爬蟲缺文章/來源斷」對到 bigcrawler-scrapy)。這應是大多數 issue 的常態,因為 REPO NOTES 就是為此設計的。',
    '    * 0.70 - 0.85:issue 症狀能對應 REPO NOTES 但用的是比較間接的詞(例如症狀 vs REPO NOTES 用不同語彙),需要靠推理接上。',
    '    * 0.50 - 0.70:issue 描述涵蓋多個 repo 的職責範圍,REPO NOTES 能鎖定最可能的一個但也不能完全排除另一個(跨層問題)。',
    '    * < 0.5 (少見):issue 幾乎只有標題、或描述與所有 REPO NOTES 都對不上、或多個 repo 同等可能且無法區分。',
    '  範例:「AI 報告顯示的聲量與實際 UI 不符」→ REPO NOTES 明確把「AI 報告內的聲量判讀」歸 engine-api → confidence 0.9。',
    '- reasoning 用 1-2 句繁體中文 (zh-TW) 說明:引用 REPO NOTES 中對 top-1 repo 的職責描述,並指出 issue 描述哪個詞彙命中。',
    '- caveats 只列「triage 人員需要人工確認的地方」,不是信心的負向佐證。例子:「需先向 reporter 確認影響範圍」、「截圖文字模糊」。不要為了列而列;沒有就給 [] 空陣列。不要寫「可能有其他 repo 相關」這種冗句,那應該反映在 confidence 數值。',
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

  // Strip repo_descriptions from the raw JSON dump; we render it as a clean
  // scoped block below so the model doesn't see a giant JSON blob of all repos.
  const cfgForJson = label_config && typeof label_config === 'object'
    ? { ...label_config }
    : label_config;
  if (cfgForJson && 'repo_descriptions' in cfgForJson) delete cfgForJson.repo_descriptions;

  const labelConfigBlock = [
    '=== LABEL CONFIG ===',
    JSON.stringify(cfgForJson, null, 2),
  ].join('\n');

  const repoNotesBlock = renderRepoNotes(label_config, new_issue);

  let similarBlock;
  if (!similar_issues || similar_issues.length === 0) {
    similarBlock = [
      '=== SIMILAR PAST ISSUES ===',
      'NO SIMILAR ISSUES FOUND — cold start。',
      '信心分數主要依 REPO NOTES 匹配強度評估;沒有歷史加成,不需要自動扣分。',
      '如果 REPO NOTES 能明確對應 issue 症狀,仍可報 0.8+。',
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
    labelConfigBlock,
    ...(repoNotesBlock ? ['', repoNotesBlock] : []),
    '',
    similarBlock,
    '',
    '請 invoke route_issue tool 回傳你的結構化建議。',
  ].join('\n');
}

/**
 * Render a "REPO NOTES" block scoped to repos reachable from the issue's
 * labels (via known_exceptions / layers) plus the primary_group prefix
 * sweep. Returns empty string if config has no repo_descriptions or no
 * matching repos.
 */
export function renderRepoNotes(labelConfig, newIssue) {
  const descs = labelConfig?.repo_descriptions;
  if (!descs || typeof descs !== 'object') return '';
  const issueLabels = new Set(newIssue?.labels ?? []);

  const candidates = new Set();
  for (const [labelName, spec] of Object.entries(labelConfig?.labels ?? {})) {
    if (!issueLabels.has(labelName)) continue;
    for (const repo of spec.known_exceptions ?? []) candidates.add(repo);
    for (const repos of Object.values(spec.layers ?? {})) {
      for (const r of repos) candidates.add(r);
    }
  }

  const notes = [];
  for (const repo of candidates) {
    if (descs[repo]) notes.push(`- ${repo}: ${descs[repo].trim().replace(/\s+/g, ' ')}`);
  }
  if (notes.length === 0) return '';
  return ['=== REPO NOTES (routing hints) ===', ...notes].join('\n');
}
