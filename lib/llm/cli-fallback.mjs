// lib/llm/cli-fallback.mjs — reusable wrapper around `claude --print` that
// mimics the Anthropic SDK `tool_use` response shape.
//
// Used by phase1-routing and phase2-plan when ANTHROPIC_API_KEY is not set
// (e.g., when running the eval from a dev machine that has the Claude CLI
// logged in but no raw API key). The returned envelope matches the SDK shape
// so the existing `content.find(b => b.type === 'tool_use')` extraction paths
// in phase1/2 keep working unchanged.
//
// Design decisions:
//   - We can't force tool_use via CLI, so we wrap the prompt with an output
//     contract asking for JSON matching the tool's input_schema.
//   - stdout is cleaned: markdown fences stripped, prose before first `{` /
//     after last `}` trimmed.
//   - Missing `required` fields surface as a typed error so callers can
//     distinguish "CLI returned junk" from "CLI returned valid JSON but
//     didn't follow the schema."
//   - Dependency injection (`spawn`) for testability.

import { spawn as defaultSpawn } from 'node:child_process';

const DEFAULT_MODEL = 'sonnet';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Call `claude --print` with a tool-calling prompt and return an Anthropic
 * SDK-shaped tool_use response.
 *
 * @param {object} params
 * @param {string} params.prompt - user prompt (will be wrapped with a tool
 *   contract so the model knows what JSON to produce)
 * @param {object} params.toolSchema - { name, description?, input_schema }
 * @param {string} [params.model='sonnet'] - passed to `claude --model`
 * @param {number} [params.timeoutMs=60000] - kill the CLI after this many ms
 * @param {Function} [params.spawn] - child_process.spawn (injectable)
 * @returns {Promise<{ content: Array<{ type: 'tool_use', name: string, input: object }> }>}
 */
export async function callClaudeCliWithTool({
  prompt,
  toolSchema,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawn = defaultSpawn,
} = {}) {
  if (!toolSchema || typeof toolSchema !== 'object' || !toolSchema.name) {
    throw makeError('cli_error', 'callClaudeCliWithTool: toolSchema.name required');
  }

  const wrappedPrompt = buildWrappedPrompt(prompt ?? '', toolSchema);

  const stdout = await runClaudeCli({
    prompt: wrappedPrompt,
    model,
    timeoutMs,
    spawn,
  });

  const cleaned = cleanOutput(stdout);
  if (!cleaned) {
    throw makeError('cli_invalid_json', 'CLI produced empty/no-JSON output', {
      raw: stdout,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw makeError('cli_invalid_json', `CLI output not valid JSON: ${e.message}`, {
      raw: stdout,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw makeError('cli_invalid_json', 'CLI output was not a JSON object', {
      raw: stdout,
    });
  }

  const required = Array.isArray(toolSchema.input_schema?.required)
    ? toolSchema.input_schema.required
    : [];
  const missing = required.filter((k) => !(k in parsed));
  if (missing.length > 0) {
    throw makeError(
      'cli_schema_mismatch',
      `CLI JSON missing required fields: ${missing.join(', ')}`,
      { missing, raw: stdout, parsed },
    );
  }

  return {
    content: [
      {
        type: 'tool_use',
        name: toolSchema.name,
        input: parsed,
      },
    ],
  };
}

// ---- helpers ----------------------------------------------------------------

function buildWrappedPrompt(userPrompt, toolSchema) {
  const schemaJson = JSON.stringify(toolSchema.input_schema ?? {}, null, 2);
  const required = Array.isArray(toolSchema.input_schema?.required)
    ? toolSchema.input_schema.required.join(', ')
    : '(none)';

  return [
    userPrompt,
    '',
    '=== TOOL CONTRACT ===',
    `你是一個 tool-calling agent。你的工作是呼叫 tool \`${toolSchema.name}\`,`,
    '但因為目前沒有 tool_use API channel,請直接輸出「tool 輸入 JSON」作為回應。',
    '',
    `Tool name: ${toolSchema.name}`,
    `Required fields: ${required}`,
    '',
    'Tool input_schema:',
    schemaJson,
    '',
    '輸出規則 (非常嚴格):',
    '- 只輸出 raw JSON,不要任何 markdown code fence (```json ... ```)',
    '- 不要任何解釋、前言、後記,純 JSON',
    '- JSON 必須符合上方 schema,所有 required 欄位都要有',
    '- enum 欄位必須從允許的值中挑一個,不要發明新的',
    '- 欄位型別必須正確 (string 就是 string,array 就是 array)',
    '',
    '現在請輸出 JSON:',
  ].join('\n');
}

function cleanOutput(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (!s) return '';

  // Strip markdown fences: ```json ... ``` or ``` ... ```
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }

  // Also handle a fence embedded in prose: grab the first fenced block if one
  // is in there and it looks like JSON.
  if (!s.startsWith('{')) {
    const embedded = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (embedded && embedded[1].trim().startsWith('{')) {
      s = embedded[1].trim();
    }
  }

  // Find first { and last } and slice to the balanced range.
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) {
    return '';
  }
  s = s.slice(firstBrace, lastBrace + 1);
  return s;
}

function runClaudeCli({ prompt, model, timeoutMs, spawn }) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('claude', ['--print', '--model', model], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(makeError('cli_error', `spawn failed: ${e.message}`));
      return;
    }

    let out = '';
    let err = '';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      try {
        if (proc && typeof proc.kill === 'function') proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(reject, makeError('cli_timeout', `claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (proc.stdout && typeof proc.stdout.on === 'function') {
      proc.stdout.on('data', (d) => {
        out += typeof d === 'string' ? d : d.toString();
      });
    }
    if (proc.stderr && typeof proc.stderr.on === 'function') {
      proc.stderr.on('data', (d) => {
        err += typeof d === 'string' ? d : d.toString();
      });
    }
    proc.on('error', (e) => {
      finish(reject, makeError('cli_error', `claude CLI error: ${e.message}`, { stderr: err }));
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        finish(
          reject,
          makeError('cli_error', `claude CLI exited ${code}: ${err.slice(0, 500)}`, {
            exitCode: code,
            stderr: err,
          }),
        );
      } else {
        finish(resolve, out);
      }
    });

    try {
      if (proc.stdin && typeof proc.stdin.write === 'function') {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }
    } catch (e) {
      finish(reject, makeError('cli_error', `stdin write failed: ${e.message}`));
    }
  });
}

function makeError(code, message, meta = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, meta);
  return err;
}
