// test/eval/judge-sonnet.mjs — Claude CLI sonnet-4-5 judge wrapper for Eval v2.
// See design doc "Eval v2 Phase II" (in progress) for context.
//
// Shells out to `claude --print --model sonnet-4-5` via execFile, piping the
// constructed prompt via stdin. Reuses the user's Claude CLI auth — no API key
// management needed in this module.
//
// The judge is BLIND to ground truth: it sees only the issue (title, description,
// labels) and the proposed plan (phase1 routing + phase2 plan_draft). It scores
// on a 1-5 rubric (relevance, actionability, correctness, coverage) and returns
// a JSON object.
//
// Robustness:
//   - 60s timeout per call
//   - Strips markdown code fences from stdout
//   - On parse error / timeout / exec error → returns { error, raw }
//   - maxRetries = 1 (judge should be deterministic; if it fails twice, skip)
//
// Dependency injection: `exec` param (defaults to execFile) for testing.

import { execFile as defaultExecFile } from 'node:child_process';

// NOTE: Claude CLI 2.1.x doesn't expose an explicit `sonnet-4-5` alias; only `sonnet`
// (→ latest, currently 4.6) and `haiku` / `opus` are reliable. Using `sonnet` here
// means the judge shares the same model family as phase1/phase2 — version
// decorrelation is lost. For cross-family independence, swap to `haiku` or wire
// via codex CLI (Gemini/GPT) as a separate judge path.
const DEFAULT_MODEL = 'sonnet';
const DEFAULT_TIMEOUT_MS = 60_000;
const DESCRIPTION_TRUNCATE = 800;

const REQUIRED_RUBRIC_FIELDS = ['relevance', 'actionability', 'correctness', 'coverage'];

/**
 * Run the judge. Returns `{ relevance, actionability, correctness, coverage, avg, reasoning }`
 * on success, or `{ error, raw }` on failure.
 *
 * @param {object} params
 * @param {object} params.issue - { title, description, labels }
 * @param {object} params.phase1Output - routing output (suggested_repos, assignees, layer, reasoning, confidence)
 * @param {object|null} params.phase2Output - { summary, plan_draft } or null for low-conf skip
 * @param {Function} [params.exec] - child_process.execFile (injectable for tests)
 * @param {number} [params.timeoutMs]
 * @param {number} [params.maxRetries] - default 1 (so up to 2 attempts total)
 * @param {string} [params.model] - default sonnet-4-5
 */
export async function runJudge({
  issue,
  phase1Output,
  phase2Output,
  exec = defaultExecFile,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 1,
  model = DEFAULT_MODEL,
} = {}) {
  const prompt = buildJudgePrompt({ issue, phase1Output, phase2Output });

  let lastResult = null;
  const maxAttempts = Math.max(1, maxRetries + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { stdout } = await execPromise(
        exec,
        'claude',
        ['--print', '--model', model],
        { timeout: timeoutMs },
        prompt
      );
      const parsed = parseJudgeOutput(stdout);
      if (!parsed.error) return parsed;
      lastResult = parsed;
    } catch (err) {
      lastResult = {
        error: 'exec_failure',
        raw: String(err?.message ?? err),
      };
    }
  }

  return lastResult ?? { error: 'unknown', raw: '' };
}

/**
 * Build the judge prompt. Judge sees issue + plan, NOT ground truth.
 * @param {object} params
 * @param {object} params.issue
 * @param {object} params.phase1Output
 * @param {object|null} params.phase2Output
 * @returns {string}
 */
export function buildJudgePrompt({ issue, phase1Output, phase2Output }) {
  const title = issue?.title ?? '(untitled)';
  const labels = (issue?.labels ?? []).join(', ') || '(none)';
  const description = truncate(String(issue?.description ?? ''), DESCRIPTION_TRUNCATE);

  const suggestedRepos = (phase1Output?.suggested_repos ?? []).join(', ') || '(none)';
  const suggestedAssignees = (phase1Output?.suggested_assignees ?? []).join(', ') || '(none)';
  const layer = phase1Output?.layer ?? 'n/a';
  const reasoning = phase1Output?.reasoning ?? '(none)';
  const confidence = phase1Output?.confidence ?? 'n/a';
  const planDraftLines =
    Array.isArray(phase2Output?.plan_draft) && phase2Output.plan_draft.length > 0
      ? phase2Output.plan_draft.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
      : '(none — 低信心跳過或未生成)';
  const risksLines =
    Array.isArray(phase2Output?.risks) && phase2Output.risks.length > 0
      ? phase2Output.risks.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
      : '(none — 未列出風險)';

  return [
    '你是一個 code review judge。不是實作者。以下 issue 有一個路由/計畫提案,請用 rubric 評分。',
    '',
    'Rubric(每項 1-5 分,5 最佳):',
    '1. Relevance — 提案的 repo 建議對這個 issue 內容是否 plausible',
    '2. Actionability — plan_draft 是具體可執行還是抽象口號',
    '3. Correctness — 基於 issue description 看,提案的診斷路徑是否技術合理',
    '4. Coverage — 是否提到了主要相關面向(repo、assignee、風險)。risks 欄位若具體且相關則加分,若只寫「沒有風險」或空則扣分。',
    '',
    '嚴格使用 JSON output: {"relevance": N, "actionability": N, "correctness": N, "coverage": N, "reasoning": "...(1-2 zh-TW 句子)"}',
    '',
    'Issue:',
    `Title: ${title}`,
    `Labels: ${labels}`,
    'Description:',
    description,
    '',
    'Proposed plan:',
    `suggested_repos: ${suggestedRepos}`,
    `suggested_assignees: ${suggestedAssignees}`,
    `layer: ${layer}`,
    `reasoning: ${reasoning}`,
    `confidence: ${confidence}`,
    'plan_draft:',
    planDraftLines,
    'risks:',
    risksLines,
  ].join('\n');
}

/**
 * Parse judge stdout. Handles JSON, JSON wrapped in ```json fences, or free text
 * containing a JSON object.
 *
 * @param {string} raw
 * @returns {object} parsed rubric OR `{ error, raw }`
 */
export function parseJudgeOutput(raw) {
  if (!raw || typeof raw !== 'string') {
    return { error: 'parse_failure', raw: String(raw ?? '') };
  }

  let cleaned = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` code fences.
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    // Try to find a JSON object embedded in text.
    const braceStart = cleaned.indexOf('{');
    const braceEnd = cleaned.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      cleaned = cleaned.slice(braceStart, braceEnd + 1);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { error: 'parse_failure', raw };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'parse_failure', raw };
  }

  for (const field of REQUIRED_RUBRIC_FIELDS) {
    if (typeof parsed[field] !== 'number') {
      return { error: 'parse_failure', raw };
    }
  }

  const avg =
    (parsed.relevance + parsed.actionability + parsed.correctness + parsed.coverage) / 4;

  return {
    relevance: parsed.relevance,
    actionability: parsed.actionability,
    correctness: parsed.correctness,
    coverage: parsed.coverage,
    avg,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

// ---- helpers ----------------------------------------------------------------

function truncate(s, maxChars) {
  const chars = Array.from(s);
  if (chars.length <= maxChars) return s;
  return chars.slice(0, maxChars).join('');
}

function execPromise(exec, cmd, args, opts, stdinInput) {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
    try {
      if (child && child.stdin && typeof child.stdin.write === 'function') {
        child.stdin.write(stdinInput);
        child.stdin.end();
      }
    } catch (e) {
      reject(e);
    }
  });
}
