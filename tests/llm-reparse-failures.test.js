import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function run(parsedData, messagesData) {
  const tmpDir = os.tmpdir();
  const parsedPath = path.join(tmpDir, 'test-parsed.json');
  const messagesPath = path.join(tmpDir, 'test-messages.json');
  fs.writeFileSync(parsedPath, JSON.stringify(parsedData));
  fs.writeFileSync(messagesPath, JSON.stringify(messagesData));
  try {
    return execSync(
      `node scripts/llm-reparse-failures.js ${parsedPath} ${messagesPath}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '..') }
    );
  } catch (e) {
    return e.stdout || '';
  }
}

describe('llm-reparse-failures', () => {
  it('outputs nothing when no failures exist', () => {
    const parsed = {
      dateEntries: {
        '4/1': { entry: { A: { total: 8, meeting: 1, dev: 7, status: 'reported' } } },
      },
    };
    const messages = { messages: [] };
    const output = run(parsed, messages);
    expect(output).toBe('');
  });

  it('builds prompt for replied_no_hours entries', () => {
    const parsed = {
      dateEntries: {
        '4/1': { entry: { Joe: { total: null, meeting: null, dev: null, status: 'replied_no_hours' } } },
      },
    };
    const messages = {
      messages: [{
        sender: { name: 'users/104537680262283646232' },
        text: '4/1 進度：\n1. [In Progress] KOL 開發 (branch, 4H)',
        createTime: '2026-04-02T02:00:00Z',
      }],
    };
    const output = run(parsed, messages);
    expect(output).toContain('4/1');
    expect(output).toContain('Joe');
    expect(output).toContain('KOL');
    expect(output).toContain('JSON array');
  });
});

describe('merge-parse-results', () => {
  function runMerge(parsedData, llmOutput) {
    const tmpDir = os.tmpdir();
    const parsedPath = path.join(tmpDir, 'test-merge-parsed.json');
    const llmPath = path.join(tmpDir, 'test-merge-llm.json');
    fs.writeFileSync(parsedPath, JSON.stringify(parsedData));
    fs.writeFileSync(llmPath, JSON.stringify(llmOutput));
    return execSync(
      `node scripts/merge-parse-results.js ${parsedPath} ${llmPath}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '..') }
    );
  }

  it('overwrites replied_no_hours entries with LLM results', () => {
    const parsed = {
      dateEntries: {
        '4/1': { entry: { Joe: { total: null, meeting: null, dev: null, status: 'replied_no_hours' } } },
      },
    };
    const llm = [{ date: '4/1', member: 'Joe', total: 7, meeting: 0, dev: 7 }];
    const result = JSON.parse(runMerge(parsed, llm));
    expect(result.dateEntries['4/1'].entry.Joe.total).toBe(7);
    expect(result.dateEntries['4/1'].entry.Joe.status).toBe('reported');
  });

  it('does not overwrite already-reported entries', () => {
    const parsed = {
      dateEntries: {
        '4/1': { entry: { A: { total: 8, meeting: 1, dev: 7, status: 'reported' } } },
      },
    };
    const llm = [{ date: '4/1', member: 'A', total: 5, meeting: 0, dev: 5 }];
    const result = JSON.parse(runMerge(parsed, llm));
    expect(result.dateEntries['4/1'].entry.A.total).toBe(8); // unchanged
  });

  it('handles malformed LLM output gracefully', () => {
    const parsed = {
      dateEntries: { '4/1': { entry: { A: { total: null, status: 'replied_no_hours' } } } },
    };
    const result = runMerge(parsed, 'not valid json');
    const data = JSON.parse(result);
    expect(data.dateEntries['4/1'].entry.A.total).toBeNull(); // unchanged
  });
});
