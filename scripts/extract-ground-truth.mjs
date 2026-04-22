#!/usr/bin/env node
// scripts/extract-ground-truth.mjs — Eval v2 Phase I CLI runner.
// Fetches closed issues by label, extracts ground truth via tiered ensemble
// (MR cross-refs + LLM comment reader), writes GOLD/SILVER fixtures + report.
//
// Usage:
//   node scripts/extract-ground-truth.mjs --label K5 --since 2026-01-01 \
//     --until today --limit 150 --output test/eval/real-fixtures/
//
// Auth:
//   - Uses ANTHROPIC_API_KEY via @anthropic-ai/sdk if set.
//   - Else shells out to `claude --print --model sonnet-4-6` (reuses Claude CLI auth).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  extractMrCrossRefs,
  extractAssigneeHeuristic,
  classifyIssueOutcome,
  buildLLMExtractorPrompt,
  parseLLMExtractorOutput,
  combineSignals,
  buildFixtureJson,
  EXTRACTOR_TOOL,
} from '../lib/ground-truth-extractor.mjs';
import { createGitLabClient, GitLabApiError } from '../lib/gitlab-client.mjs';
import { loadLabelRouting, validateConfig, getRepoSuggestions } from '../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DEFAULT_PROJECTS = ['techcenter/reportcenter', 'techcenter/reportcenter_confidential'];
const CONCURRENCY = 3;
const GOLD_TARGET = 100;

// ---- arg parsing ------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    label: 'K5',
    since: null,
    until: null,
    limit: 150,
    output: 'test/eval/real-fixtures/',
    projects: DEFAULT_PROJECTS,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--label':
        args.label = v; i++; break;
      case '--since':
        args.since = v; i++; break;
      case '--until':
        args.until = v === 'today' ? new Date().toISOString().slice(0, 10) : v; i++; break;
      case '--limit':
        args.limit = parseInt(v, 10); i++; break;
      case '--output':
        args.output = v; i++; break;
      case '--projects':
        args.projects = v.split(',').map((s) => s.trim()); i++; break;
      case '--dry-run':
        args.dryRun = true; break;
      case '--help':
      case '-h':
        console.log('Usage: extract-ground-truth.mjs --label K5 --since YYYY-MM-DD [--until today] [--limit 150] [--output test/eval/real-fixtures/]');
        process.exit(0);
    }
  }
  return args;
}

// ---- LLM runner (SDK or CLI shell-out) --------------------------------------

/**
 * Call the LLM extractor. Returns a parsed result object or throws.
 * Tries Anthropic SDK first (if ANTHROPIC_API_KEY). Falls back to `claude --print`.
 */
async function runLLMExtractor(prompt, { logger = console } = {}) {
  if (process.env.ANTHROPIC_API_KEY) {
    return await runLLMViaSdk(prompt);
  }
  return await runLLMViaClaudeCli(prompt, logger);
}

async function runLLMViaSdk(prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    tools: [EXTRACTOR_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTOR_TOOL.name },
    messages: [{ role: 'user', content: prompt }],
  });
  const toolUse = (resp?.content ?? []).find(
    (b) => b?.type === 'tool_use' && b?.name === EXTRACTOR_TOOL.name,
  );
  if (!toolUse) throw new Error('SDK: no tool_use block in response');
  const usage = resp?.usage ?? {};
  return {
    parsed: parseLLMExtractorOutput(toolUse),
    usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 },
  };
}

/**
 * Shell out to `claude --print` with a prompt that asks for JSON matching the
 * EXTRACTOR_TOOL schema. We can't force tool_use via the CLI, so we ask for
 * structured JSON output and parse it into the same shape.
 */
async function runLLMViaClaudeCli(prompt, logger) {
  const wrappedPrompt = [
    prompt,
    '',
    '=== OUTPUT CONTRACT ===',
    '你必須回傳「純 JSON」(不要 markdown code fence, 不要任何解釋文字),',
    '欄位如下:',
    '{',
    '  "outcome": "likely_fixed" | "duplicate" | "wont_fix" | "customer_error" | "no_fix_needed" | "unclear",',
    '  "fix_repos": ["group/project", ...],',
    '  "primary_repo": "group/project" | "",',
    '  "confidence": "high" | "med" | "low",',
    '  "reasoning": "1-2 句 zh-TW"',
    '}',
    '只輸出這個 JSON,其他都不要。',
  ].join('\n');

  const stdout = await runClaudeCli(wrappedPrompt);
  const parsed = extractJsonFromText(stdout);
  if (!parsed) {
    throw new Error(`claude CLI: could not parse JSON from output: ${stdout.slice(0, 200)}`);
  }
  // Normalize into the same shape parseLLMExtractorOutput expects.
  const fake = { type: 'tool_use', name: EXTRACTOR_TOOL.name, input: parsed };
  return { parsed: parseLLMExtractorOutput(fake), usage: null };
}

function runClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', '--model', 'sonnet'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 500)}`));
      } else {
        resolve(out);
      }
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function extractJsonFromText(text) {
  if (!text) return null;
  // Strip markdown fences if present.
  const noFence = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
  // Find first "{" and matching close
  const start = noFence.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < noFence.length; i++) {
    const ch = noFence[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = noFence.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---- Per-issue pipeline ------------------------------------------------------

async function processIssue({ issue, projectPath, client, labelCfgForLabel, label, logger, llmStats }) {
  const notes = await client.fetchIssueNotes(projectPath, issue.iid);
  const systemNotes = notes.filter((n) => n.system);
  const userNotes = notes.filter((n) => !n.system);

  const mrRefs = extractMrCrossRefs(systemNotes);
  const assigneeHeuristic = extractAssigneeHeuristic({ issue, assigneeCommitsByRepo: null });
  const det = classifyIssueOutcome({ issue, comments: notes });

  // Build LLM prompt and call
  const prompt = buildLLMExtractorPrompt({
    issue: { ...issue, project_path: projectPath },
    comments: notes,
    labelConfig: labelCfgForLabel,
  });

  let llmResult;
  try {
    const { parsed, usage } = await runLLMExtractor(prompt, { logger });
    llmResult = parsed;
    if (usage) {
      llmStats.input_tokens += usage.input_tokens;
      llmStats.output_tokens += usage.output_tokens;
    }
    llmStats.calls += 1;
  } catch (err) {
    logger.warn(`[extract] LLM call failed for #${issue.iid}: ${err.message}`);
    // Fall back to deterministic classifier only.
    llmResult = {
      repos: new Set(),
      primary_repo: null,
      outcome: det,
      confidence: 'low',
      reason: `LLM error: ${err.message.slice(0, 120)}`,
    };
    llmStats.errors += 1;
  }

  const signals = {
    mrRefs,
    assigneeHeuristic,
    llmExtractor: llmResult,
  };
  const combined = combineSignals(signals);
  const fixture = buildFixtureJson({
    issue: { ...issue, project_path: projectPath },
    comments: userNotes,
    signals,
    combinedResult: combined,
  });

  return { issue, fixture, signals, combined };
}

// ---- Concurrency pool --------------------------------------------------------

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- Fetch closed issues by label -------------------------------------------

async function fetchClosedByLabel(baseUrl, token, projectPath, { label, since, until }) {
  const encoded = encodeURIComponent(projectPath);
  const params = new URLSearchParams({
    state: 'closed',
    labels: label,
    per_page: '100',
    order_by: 'updated_at',
    sort: 'desc',
  });
  if (since) params.set('created_after', `${since}T00:00:00Z`);
  if (until) params.set('created_before', `${until}T23:59:59Z`);

  const all = [];
  let page = 1;
  while (true) {
    params.set('page', String(page));
    const url = `${baseUrl}/api/v4/projects/${encoded}/issues?${params.toString()}`;
    const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } });
    if (!res.ok) {
      throw new GitLabApiError(`GitLab ${res.status} ${res.statusText}`, {
        status: res.status, endpoint: url,
      });
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    all.push(...arr);
    if (arr.length < 100) break;
    page += 1;
    if (page > 20) break; // safety cap
  }
  return all;
}

// ---- Report builder ----------------------------------------------------------

function buildReport({ args, stats, outcomesHistogram, topRepos, costUSD, llmStats, mode }) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Ground Truth Extraction Report — ${date}`,
    '',
    '## Run Parameters',
    '',
    `- Label: \`${args.label}\``,
    `- Since: \`${args.since ?? '(none)'}\``,
    `- Until: \`${args.until ?? '(none)'}\``,
    `- Limit: ${args.limit}`,
    `- Projects: ${args.projects.join(', ')}`,
    `- Output: \`${args.output}\``,
    `- LLM mode: \`${mode}\``,
    '',
    '## Stats',
    '',
    '| bucket | count |',
    '|---|---|',
    `| fetched | ${stats.fetched} |`,
    `| GOLD (written) | ${stats.gold} |`,
    `| SILVER (written) | ${stats.silver} |`,
    `| BRONZE (not written) | ${stats.bronze} |`,
    `| SKIP (duplicate/wont_fix/customer_error) | ${stats.skip} |`,
    `| errors | ${stats.errors} |`,
    '',
    '## Outcome Histogram',
    '',
    '| outcome | count |',
    '|---|---|',
    ...Object.entries(outcomesHistogram).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Top 5 fix_repos (validates label config predictions)',
    '',
    '| repo | mentions |',
    '|---|---|',
    ...topRepos.slice(0, 5).map(([r, v]) => `| \`${r}\` | ${v} |`),
    '',
    '## Cost',
    '',
    `- LLM calls: ${llmStats.calls}`,
    `- LLM errors: ${llmStats.errors}`,
    `- Input tokens: ${llmStats.input_tokens}`,
    `- Output tokens: ${llmStats.output_tokens}`,
    `- Est. cost (Sonnet 4.6): $${costUSD.toFixed(2)}`,
    '',
    '## Known Gaps / TODOs',
    '',
    '- Assignee heuristic (signal 2) **disabled in v0** — needs cross-repo commit',
    '  fetching, which is expensive. Re-enable in v1.1 once we have a commits cache.',
    '- Anonymization is conservative; expand blacklist if review surfaces leaked',
    '  customer names.',
    '- CLI fallback path (claude --print) can\'t force tool_use; we rely on JSON',
    '  output contract instead. If the CLI returns malformed JSON, LLM signal is',
    '  treated as a low-confidence error.',
  ];
  return lines.join('\n');
}

// ---- main --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const logger = console;

  const gitlabCfg = JSON.parse(readFileSync(join(REPO_ROOT, 'gitlab-config.json'), 'utf8'));
  const labelConfig = loadLabelRouting(join(REPO_ROOT, 'config', 'label-routing.yaml'));
  validateConfig(labelConfig);
  const labelCfgForLabel = getRepoSuggestions(labelConfig, args.label);

  const client = createGitLabClient({ baseUrl: gitlabCfg.baseUrl, token: gitlabCfg.token });

  const outDir = join(REPO_ROOT, args.output);
  mkdirSync(outDir, { recursive: true });

  // Fetch all candidate closed issues across configured projects.
  logger.log(`[extract] fetching closed ${args.label} issues from ${args.projects.length} projects...`);
  const fetched = [];
  for (const p of args.projects) {
    try {
      const issues = await fetchClosedByLabel(gitlabCfg.baseUrl, gitlabCfg.token, p, {
        label: args.label, since: args.since, until: args.until,
      });
      logger.log(`[extract]   ${p}: ${issues.length} issues`);
      for (const i of issues) fetched.push({ projectPath: p, issue: i });
    } catch (err) {
      logger.error(`[extract] ${p} fetch failed: ${err.message}`);
    }
  }

  // Apply --limit (most-recently-updated first per project fetch ordering).
  const candidates = fetched.slice(0, args.limit);
  logger.log(`[extract] ${candidates.length} candidates after --limit ${args.limit}`);

  const mode = process.env.ANTHROPIC_API_KEY ? 'sdk' : 'cli';
  logger.log(`[extract] LLM mode: ${mode}`);

  const stats = { fetched: candidates.length, gold: 0, silver: 0, bronze: 0, skip: 0, errors: 0 };
  const outcomesHistogram = {};
  const repoMentions = new Map();
  const llmStats = { calls: 0, errors: 0, input_tokens: 0, output_tokens: 0 };

  // Early-stop: short-circuit the pool when we reach GOLD_TARGET.
  let stopEarly = false;

  const results = await runPool(candidates, async (item) => {
    if (stopEarly) return null;
    try {
      const r = await processIssue({
        issue: item.issue,
        projectPath: item.projectPath,
        client,
        labelCfgForLabel,
        label: args.label,
        logger,
        llmStats,
      });
      const { combined, fixture } = r;
      outcomesHistogram[combined.outcome] = (outcomesHistogram[combined.outcome] ?? 0) + 1;
      for (const repo of combined.fix_repos ?? []) {
        repoMentions.set(repo, (repoMentions.get(repo) ?? 0) + 1);
      }
      if (combined.tier === 'GOLD') {
        stats.gold += 1;
        if (!args.dryRun) writeFixture(outDir, fixture);
      } else if (combined.tier === 'SILVER') {
        stats.silver += 1;
        if (!args.dryRun) writeFixture(outDir, fixture);
      } else if (combined.tier === 'BRONZE') {
        stats.bronze += 1;
      } else if (combined.tier === 'SKIP') {
        stats.skip += 1;
      }
      logger.log(`[extract] #${item.issue.iid} ${combined.tier} outcome=${combined.outcome} repos=[${(combined.fix_repos ?? []).join(',')}]`);
      if (stats.gold >= GOLD_TARGET) stopEarly = true;
      return r;
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[extract] #${item.issue?.iid ?? '?'} ERROR: ${err.message}`);
      return null;
    }
  }, CONCURRENCY);

  // Cost estimate: Sonnet 4.6 pricing approx $3/M input, $15/M output.
  const costUSD = (llmStats.input_tokens / 1_000_000) * 3 + (llmStats.output_tokens / 1_000_000) * 15;

  const topRepos = [...repoMentions.entries()].sort((a, b) => b[1] - a[1]);

  const reportDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportMd = buildReport({ args, stats, outcomesHistogram, topRepos, costUSD, llmStats, mode });
  const reportPath = join(outDir, `extraction-report-${reportDate}.md`);
  writeFileSync(reportPath, reportMd);

  logger.log('\n[extract] DONE');
  logger.log(`  fetched=${stats.fetched} GOLD=${stats.gold} SILVER=${stats.silver} BRONZE=${stats.bronze} SKIP=${stats.skip} errors=${stats.errors}`);
  logger.log(`  cost≈$${costUSD.toFixed(2)}`);
  logger.log(`  report: ${reportPath}`);
}

function writeFixture(outDir, fixture) {
  const path = join(outDir, `${fixture.fixture_id}.json`);
  if (existsSync(path)) {
    // Append a suffix to avoid collision.
    writeFileSync(path.replace(/\.json$/, `-${Date.now()}.json`), JSON.stringify(fixture, null, 2));
  } else {
    writeFileSync(path, JSON.stringify(fixture, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[extract] FATAL', e);
    process.exit(1);
  });
}
