#!/usr/bin/env node
// scripts/reaggregate-eval-with-config.mjs
//
// Re-aggregate an existing eval JSON with the current assignee config, without
// rerunning the LLM. Applies the Phase 1 override (suggested_assignees ←
// label's default_assignees) to each cached per_fixture.phase1, then recomputes
// all metrics via analyzeGap + aggregate.
//
// Usage:
//   node scripts/reaggregate-eval-with-config.mjs <path-to-eval.json>
//
// Writes a new timestamped JSON next to the input.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYAML } from 'yaml';

import { analyzeGap, aggregate } from '../test/eval/gap-analyzer.mjs';
import { collectDefaultAssignees } from '../lib/llm/phase1-routing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'test', 'eval', 'real-fixtures');
const LABEL_CONFIG_PATH = join(PROJECT_ROOT, 'config', 'label-routing.yaml');

function loadFixturesById() {
  const byId = new Map();
  if (!existsSync(FIXTURES_DIR)) return byId;
  for (const f of readdirSync(FIXTURES_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const fx = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8'));
      const key = fx?.id ?? fx?.issue?.iid;
      if (key != null) byId.set(String(key), fx);
    } catch {
      /* skip malformed */
    }
  }
  return byId;
}

function main() {
  const inPath = process.argv[2];
  if (!inPath) {
    console.error('usage: reaggregate-eval-with-config.mjs <path-to-eval.json>');
    process.exit(1);
  }
  const input = JSON.parse(readFileSync(inPath, 'utf8'));
  const labelConfig = parseYAML(readFileSync(LABEL_CONFIG_PATH, 'utf8'));
  const fixturesById = loadFixturesById();

  const recomputedPerFixture = (input.per_fixture ?? []).map((r) => {
    const fx = fixturesById.get(String(r.fixture_id));
    if (!fx) return r; // fixture not found (renamed?) — keep as-is

    // Apply Phase 1 override — inject config-derived assignees. If phase1 is
    // null (e.g. prior fixture failed with CLI error), skip.
    let phase1 = r.phase1;
    if (phase1 && typeof phase1 === 'object') {
      const configuredAssignees = collectDefaultAssignees(labelConfig, fx?.issue?.labels ?? []);
      if (configuredAssignees.length > 0) {
        phase1 = { ...phase1, suggested_assignees: configuredAssignees.slice(0, 3) };
      }
    }

    const metrics = phase1
      ? analyzeGap({
          fixture: fx,
          phase1Output: phase1,
          phase2Output: r.phase2,
          judgeResult: r.judgeResult,
          labelConfig,
        })
      : null;

    return { ...r, phase1, metrics };
  });

  const trainMetrics = aggregate(
    recomputedPerFixture.filter((r) => r.split === 'train' && r.metrics).map((r) => r.metrics)
  );
  const testMetrics = aggregate(
    recomputedPerFixture.filter((r) => r.split === 'test' && r.metrics).map((r) => r.metrics)
  );

  const out = {
    ...input,
    train_metrics: trainMetrics,
    test_metrics: testMetrics,
    per_fixture: recomputedPerFixture,
    meta: {
      ...(input.meta ?? {}),
      reaggregated_at: new Date().toISOString(),
      reaggregated_with: 'assignee config default_assignees',
    },
  };

  const outPath = inPath.replace(/\.json$/, '-reagg-assignees.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  // Compact summary
  const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
  console.log('=== RE-AGGREGATED (assignee config) ===');
  console.log(`input:  ${basename(inPath)}`);
  console.log(`output: ${basename(outPath)}`);
  console.log('');
  console.log('Metric               |  Train  |   Test');
  console.log('---------------------|---------|---------');
  console.log(`P@1                  | ${fmt(trainMetrics.p_at_1)} | ${fmt(testMetrics.p_at_1)}`);
  console.log(`R@3                  | ${fmt(trainMetrics.r_at_3)} | ${fmt(testMetrics.r_at_3)}`);
  console.log(`Cross-repo recall    | ${fmt(trainMetrics.cross_repo_recall_avg)} | ${fmt(testMetrics.cross_repo_recall_avg)}`);
  console.log(`Assignee R@3         | ${fmt(trainMetrics.assignee_r_at_3)} | ${fmt(testMetrics.assignee_r_at_3)}`);
  console.log(`ECE                  | ${fmt(trainMetrics.ece)} | ${fmt(testMetrics.ece)}`);
  console.log(`Judge avg            | ${fmt(trainMetrics.judge_avg)} | ${fmt(testMetrics.judge_avg)}`);
}

main();
