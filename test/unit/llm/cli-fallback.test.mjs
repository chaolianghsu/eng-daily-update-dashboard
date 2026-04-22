// test/unit/llm/cli-fallback.test.mjs — unit tests for CLI fallback wrapper.
//
// Mocks `spawn` via dependency injection to avoid spawning real processes.
// Exercises: JSON extraction (fence-stripping, prose trimming), error paths
// (timeout, non-zero exit, invalid JSON, schema mismatch), shape of the
// tool_use-wrapped return value, prompt/arg construction.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

import { callClaudeCliWithTool } from '../../../lib/llm/cli-fallback.mjs';

const sampleTool = {
  name: 'route_issue',
  description: 'route an issue',
  input_schema: {
    type: 'object',
    required: ['layer', 'suggested_repos', 'reasoning', 'confidence'],
    properties: {
      layer: { type: 'string' },
      suggested_repos: { type: 'array' },
      reasoning: { type: 'string' },
      confidence: { type: 'number' },
    },
  },
};

const validPayload = {
  layer: 'n/a',
  suggested_repos: ['foo/bar'],
  reasoning: 'reason',
  confidence: 0.7,
};

/**
 * Build a mock spawn. `behavior` is called with the created proc so a test can
 * drive stdout/stderr/close events however it wants.
 */
function makeMockSpawn(behavior) {
  return vi.fn().mockImplementation((cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    const stdinWrites = [];
    proc.stdin = {
      write: vi.fn((chunk) => stdinWrites.push(String(chunk))),
      end: vi.fn(),
    };
    proc.__cmd = cmd;
    proc.__args = args;
    proc.__opts = opts;
    proc.__stdinWrites = stdinWrites;
    // Capture on the spawn mock too, so tests can inspect without grabbing the proc.
    proc.__emitStdout = (chunk) => proc.stdout.emit('data', chunk);
    proc.__emitStderr = (chunk) => proc.stderr.emit('data', chunk);
    proc.__emitClose = (code) => proc.emit('close', code);
    queueMicrotask(() => behavior(proc));
    return proc;
  });
}

describe('callClaudeCliWithTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: parses valid JSON from stdout into tool_use shape', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout(JSON.stringify(validPayload));
      proc.__emitClose(0);
    });
    const result = await callClaudeCliWithTool({
      prompt: 'test prompt',
      toolSchema: sampleTool,
      spawn,
    });
    expect(result).toEqual({
      content: [{ type: 'tool_use', name: 'route_issue', input: validPayload }],
    });
  });

  it('strips ```json fenced markdown blocks', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout('```json\n' + JSON.stringify(validPayload) + '\n```');
      proc.__emitClose(0);
    });
    const result = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    });
    expect(result.content[0].input).toEqual(validPayload);
  });

  it('strips plain ``` fenced markdown blocks', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout('```\n' + JSON.stringify(validPayload) + '\n```');
      proc.__emitClose(0);
    });
    const result = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    });
    expect(result.content[0].input).toEqual(validPayload);
  });

  it('trims leading prose before first {', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout('Here is the response:\n' + JSON.stringify(validPayload) + '\nThanks!');
      proc.__emitClose(0);
    });
    const result = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    });
    expect(result.content[0].input).toEqual(validPayload);
  });

  it('empty stdout → throws cli_invalid_json', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitClose(0);
    });
    const err = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('cli_invalid_json');
  });

  it('non-zero exit code → throws cli_error with stderr', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStderr('boom: auth failed');
      proc.__emitClose(1);
    });
    const err = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('cli_error');
    expect(String(err.message)).toMatch(/boom/);
  });

  it('timeout → throws cli_timeout', async () => {
    // Spawn never emits close, so timeout kicks in.
    const spawn = vi.fn().mockImplementation(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.kill = vi.fn();
      return proc;
    });
    const err = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
      timeoutMs: 50,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('cli_timeout');
  });

  it('missing required field → throws cli_schema_mismatch listing missing fields', async () => {
    const missing = { ...validPayload };
    delete missing.confidence;
    delete missing.reasoning;
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout(JSON.stringify(missing));
      proc.__emitClose(0);
    });
    const err = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('cli_schema_mismatch');
    expect(err.missing).toEqual(expect.arrayContaining(['confidence', 'reasoning']));
  });

  it('prompt is passed via stdin and stdin is ended', async () => {
    let captured = null;
    const spawn = makeMockSpawn((proc) => {
      captured = proc;
      proc.__emitStdout(JSON.stringify(validPayload));
      proc.__emitClose(0);
    });
    await callClaudeCliWithTool({
      prompt: 'my-unique-prompt-content',
      toolSchema: sampleTool,
      spawn,
    });
    expect(captured).not.toBeNull();
    const joined = captured.__stdinWrites.join('');
    expect(joined).toContain('my-unique-prompt-content');
    expect(captured.stdin.end).toHaveBeenCalled();
  });

  it('model arg propagates to spawn args', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout(JSON.stringify(validPayload));
      proc.__emitClose(0);
    });
    await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
      model: 'sonnet-4-6',
    });
    const [cmd, args] = spawn.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet-4-6');
  });

  it('tool schema name appears in the prompt sent to CLI', async () => {
    let captured = null;
    const spawn = makeMockSpawn((proc) => {
      captured = proc;
      proc.__emitStdout(JSON.stringify(validPayload));
      proc.__emitClose(0);
    });
    await callClaudeCliWithTool({
      prompt: 'the-user-prompt',
      toolSchema: sampleTool,
      spawn,
    });
    const joined = captured.__stdinWrites.join('');
    expect(joined).toContain('route_issue');
    expect(joined).toContain('the-user-prompt');
  });

  it('validates required fields from input_schema.required', async () => {
    // Tool with an unusual required list — the wrapper must check against THIS list,
    // not a hardcoded one.
    const oddTool = {
      name: 'odd',
      input_schema: {
        type: 'object',
        required: ['alpha', 'beta'],
        properties: { alpha: { type: 'string' }, beta: { type: 'string' } },
      },
    };
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout(JSON.stringify({ alpha: 'x' })); // missing beta
      proc.__emitClose(0);
    });
    const err = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: oddTool,
      spawn,
    }).catch((e) => e);
    expect(err.code).toBe('cli_schema_mismatch');
    expect(err.missing).toEqual(['beta']);
  });

  it('returns exactly the tool_use-shaped envelope (no stray fields)', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout(JSON.stringify(validPayload));
      proc.__emitClose(0);
    });
    const result = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    });
    expect(Object.keys(result)).toEqual(['content']);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('tool_use');
    expect(result.content[0].name).toBe('route_issue');
    expect(result.content[0].input).toEqual(validPayload);
  });

  it('handles unparseable JSON → cli_invalid_json with raw output attached', async () => {
    const spawn = makeMockSpawn((proc) => {
      proc.__emitStdout('this is definitely { not [ valid json');
      proc.__emitClose(0);
    });
    const err = await callClaudeCliWithTool({
      prompt: 'test',
      toolSchema: sampleTool,
      spawn,
    }).catch((e) => e);
    expect(err.code).toBe('cli_invalid_json');
    expect(String(err.raw ?? '')).toContain('this is definitely');
  });
});
