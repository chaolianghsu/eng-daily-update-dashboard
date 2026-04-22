#!/usr/bin/env node
// test/eval/run-eval.mjs — golden-fixture eval runner for the issue-routing LLM pipeline.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B4.
//
// Modes:
//   - OFFLINE (EVAL_OFFLINE=1 or ANTHROPIC_API_KEY unset):
//       lint all fixtures (shape + label validity) and exit 0 if they all pass.
//       Does NOT import/construct the Anthropic SDK.
//   - ONLINE:
//       import lib/llm/*, call Phase 1 (and Phase 2 if confidence >= 0.5),
//       compare results to fixture.expected, emit JSON report, exit 0 if pass rate >= 90%.
//
// Usage:
//   EVAL_OFFLINE=1 bun run issue-routing:eval             # lint only, no API calls
//   ANTHROPIC_API_KEY=... bun run issue-routing:eval      # real LLM eval

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYAML } from 'yaml';

// ---- constants --------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');
const LABEL_CONFIG_PATH = join(HERE, '..', '..', 'config', 'label-routing.yaml');
const PASS_THRESHOLD = 0.9; // 90% required to consider eval green
const PHASE2_CONFIDENCE_GATE = 0.5;

const VALID_FANTI_LAYERS = ['crawler', 'backend', 'ui', 'nginx', 'keypo_integration', 'unsure'];
const REQUIRED_FIXTURE_KEYS = ['name', 'issue', 'similar_issues', 'expected'];
const REQUIRED_ISSUE_KEYS = ['iid', 'title', 'description', 'labels', 'project_path'];
const REQUIRED_EXPECTED_KEYS = [
  'expected_repos_any_of',
  'expected_assignees_any_of',
  'min_confidence',
  'max_confidence',
  'plan_draft_required',
];

// ---- fixture + config loading ----------------------------------------------

export function loadFixtures(dir = FIXTURES_DIR) {
  const entries = readdirSync(dir).filter((f) => f.endsWith('.json'));
  return entries
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const raw = readFileSync(path, 'utf8');
      try {
        return { file: name, fixture: JSON.parse(raw) };
      } catch (e) {
        throw new Error(`Invalid JSON in fixture ${name}: ${e.message}`);
      }
    });
}

export function loadLabelConfig(path = LABEL_CONFIG_PATH) {
  const raw = readFileSync(path, 'utf8');
  return parseYAML(raw);
}

// ---- comparison logic (unit-tested) -----------------------------------------

/**
 * Compare Phase 1 + Phase 2 outputs to a fixture's `expected` block.
 *
 * @param {object} phase1 - { layer, suggested_repos, suggested_assignees, confidence, ... }
 * @param {object|null} phase2 - { summary, plan_draft } or null
 * @param {object} expected - fixture.expected
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function compareToExpected(phase1, phase2, expected) {
  const reasons = [];

  // Layer: exact match (only if expected.layer defined).
  if (expected.layer !== undefined) {
    if (phase1.layer !== expected.layer) {
      reasons.push(`layer mismatch: got '${phase1.layer}', expected '${expected.layer}'`);
    }
  }

  // Repos: at least one suggested repo must be in expected_repos_any_of (unless empty).
  const expectedRepos = expected.expected_repos_any_of || [];
  const suggestedRepos = phase1.suggested_repos || [];
  if (expectedRepos.length > 0) {
    const overlap = suggestedRepos.some((r) => expectedRepos.includes(r));
    if (!overlap) {
      reasons.push(
        `no repo overlap: got [${suggestedRepos.join(', ')}], expected any of [${expectedRepos.join(', ')}]`
      );
    }
  }

  // Assignees: at least one suggested assignee must be in expected_assignees_any_of (unless empty).
  const expectedAssignees = expected.expected_assignees_any_of || [];
  const suggestedAssignees = phase1.suggested_assignees || [];
  if (expectedAssignees.length > 0) {
    const overlap = suggestedAssignees.some((a) => expectedAssignees.includes(a));
    if (!overlap) {
      reasons.push(
        `no assignee overlap: got [${suggestedAssignees.join(', ')}], expected any of [${expectedAssignees.join(', ')}]`
      );
    }
  }

  // Confidence: in [min_confidence, max_confidence] range.
  const conf = phase1.confidence;
  if (typeof conf !== 'number' || conf < expected.min_confidence || conf > expected.max_confidence) {
    reasons.push(
      `confidence out of range: got ${conf}, expected [${expected.min_confidence}, ${expected.max_confidence}]`
    );
  }

  // plan_draft_required: matches whether phase2 produced a non-null plan_draft.
  const hasPlanDraft =
    phase2 != null && phase2.plan_draft != null && Array.isArray(phase2.plan_draft) && phase2.plan_draft.length > 0;
  if (expected.plan_draft_required && !hasPlanDraft) {
    reasons.push('plan_draft required but none produced');
  }
  if (!expected.plan_draft_required && hasPlanDraft) {
    reasons.push('plan_draft produced but fixture expected none (low-confidence skip expected)');
  }

  return { pass: reasons.length === 0, reasons };
}

// ---- fixture lint (OFFLINE mode) --------------------------------------------

/**
 * Validate a fixture's shape + referenced labels against the label config.
 *
 * @param {object} fixture
 * @param {object} labelConfig
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function lintFixture(fixture, labelConfig) {
  const reasons = [];

  if (!fixture || typeof fixture !== 'object') {
    return { pass: false, reasons: ['fixture is not an object'] };
  }

  for (const key of REQUIRED_FIXTURE_KEYS) {
    if (!(key in fixture)) reasons.push(`missing top-level field: ${key}`);
  }
  if (reasons.length > 0) return { pass: false, reasons };

  // issue shape
  const issue = fixture.issue;
  if (!issue || typeof issue !== 'object') {
    reasons.push('issue must be an object');
  } else {
    for (const key of REQUIRED_ISSUE_KEYS) {
      if (!(key in issue)) reasons.push(`issue.${key} is required`);
    }
    if (issue.labels && !Array.isArray(issue.labels)) {
      reasons.push('issue.labels must be an array');
    }
  }

  // similar_issues shape
  if (!Array.isArray(fixture.similar_issues)) {
    reasons.push('similar_issues must be an array');
  }

  // expected shape
  const expected = fixture.expected;
  if (!expected || typeof expected !== 'object') {
    reasons.push('expected must be an object');
  } else {
    for (const key of REQUIRED_EXPECTED_KEYS) {
      if (!(key in expected)) reasons.push(`expected.${key} is required`);
    }
    if (expected.min_confidence != null && expected.max_confidence != null) {
      if (expected.min_confidence > expected.max_confidence) {
        reasons.push(
          `expected.min_confidence (${expected.min_confidence}) > max_confidence (${expected.max_confidence})`
        );
      }
    }
    if (expected.plan_draft_required !== undefined && typeof expected.plan_draft_required !== 'boolean') {
      reasons.push('expected.plan_draft_required must be boolean');
    }
  }

  // label validity (only if we got past shape checks)
  if (issue && Array.isArray(issue.labels) && labelConfig?.labels) {
    const knownProductLabels = new Set(Object.keys(labelConfig.labels));
    const ignoreLabels = new Set(labelConfig.ignore_for_routing || []);
    for (const lbl of issue.labels) {
      if (!knownProductLabels.has(lbl) && !ignoreLabels.has(lbl)) {
        reasons.push(`unknown label in issue.labels: '${lbl}' (not in label_config.labels or ignore_for_routing)`);
      }
    }

    // Fanti layer check
    const hasFanti = issue.labels.includes('Fanti');
    if (expected && hasFanti && expected.layer !== undefined && expected.layer !== null) {
      if (!VALID_FANTI_LAYERS.includes(expected.layer)) {
        reasons.push(
          `invalid Fanti layer: '${expected.layer}' (must be one of: ${VALID_FANTI_LAYERS.join(', ')})`
        );
      }
    }
    if (expected && !hasFanti && expected.layer !== undefined && expected.layer !== 'n/a') {
      reasons.push(`non-Fanti fixture should have expected.layer = 'n/a' (got '${expected.layer}')`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

// ---- online eval (one fixture) ---------------------------------------------

async function runFixtureOnline(fixture, labelConfig, llm) {
  const { buildLLMContext } = llm;
  const { runPhase1Routing } = llm;
  const { runPhase2Plan } = llm;

  const ctx = buildLLMContext({
    new_issue: {
      id: fixture.issue.iid,
      title: fixture.issue.title,
      description: fixture.issue.description,
      labels: fixture.issue.labels,
      project_path: fixture.issue.project_path,
    },
    similar_issues: fixture.similar_issues,
    label_config: labelConfig,
  });

  const phase1 = await runPhase1Routing(ctx);
  let phase2 = null;
  if (phase1.confidence >= PHASE2_CONFIDENCE_GATE) {
    phase2 = await runPhase2Plan(ctx, phase1);
  }
  return { phase1, phase2 };
}

// ---- main -------------------------------------------------------------------

function isOfflineMode() {
  return process.env.EVAL_OFFLINE === '1' || !process.env.ANTHROPIC_API_KEY;
}

async function main() {
  const offline = isOfflineMode();
  const labelConfig = loadLabelConfig();
  const loaded = loadFixtures();

  if (loaded.length === 0) {
    console.error(JSON.stringify({ error: 'no fixtures found', dir: FIXTURES_DIR }));
    process.exit(1);
  }

  if (offline) {
    // LINT MODE: validate shape, labels, and Fanti layers. No SDK import, no API.
    const results = loaded.map(({ file, fixture }) => ({
      file,
      name: fixture?.name ?? file,
      ...lintFixture(fixture, labelConfig),
    }));
    const failed = results.filter((r) => !r.pass);
    const report = {
      mode: 'offline-lint',
      date: new Date().toISOString().slice(0, 10),
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed.map((r) => ({ name: r.name, reasons: r.reasons })),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(failed.length === 0 ? 0 : 1);
  }

  // ONLINE MODE — lazy-import LLM modules so offline mode never touches the SDK.
  const llm = await importLLM();

  const perFixture = [];
  for (const { file, fixture } of loaded) {
    try {
      // Still lint first — a broken fixture is a fast fail.
      const lint = lintFixture(fixture, labelConfig);
      if (!lint.pass) {
        perFixture.push({
          name: fixture?.name ?? file,
          pass: false,
          phase1: null,
          phase2: null,
          reasons: [`lint failed: ${lint.reasons.join('; ')}`],
        });
        continue;
      }

      const { phase1, phase2 } = await runFixtureOnline(fixture, labelConfig, llm);
      const cmp = compareToExpected(phase1, phase2, fixture.expected);
      perFixture.push({
        name: fixture.name,
        pass: cmp.pass,
        phase1,
        phase2,
        reasons: cmp.reasons,
      });
    } catch (err) {
      perFixture.push({
        name: fixture?.name ?? file,
        pass: false,
        phase1: null,
        phase2: null,
        reasons: [`runtime error: ${err?.code ?? err?.name ?? 'Error'}: ${err?.message ?? String(err)}`],
      });
    }
  }

  const passed = perFixture.filter((r) => r.pass).length;
  const total = perFixture.length;
  const report = {
    mode: 'online',
    date: new Date().toISOString().slice(0, 10),
    total,
    passed,
    failed: total - passed,
    failures: perFixture
      .filter((r) => !r.pass)
      .map((r) => ({ name: r.name, reasons: r.reasons })),
    per_fixture: perFixture,
  };
  console.log(JSON.stringify(report, null, 2));

  const passRate = total === 0 ? 0 : passed / total;
  process.exit(passRate >= PASS_THRESHOLD ? 0 : 1);
}

async function importLLM() {
  // Dynamic imports so OFFLINE mode (which may run in CI without the SDK) can skip.
  const root = join(HERE, '..', '..');
  const [{ buildLLMContext }, { runPhase1Routing }, { runPhase2Plan }] = await Promise.all([
    import(pathToFileURL(join(root, 'lib', 'llm', 'context-builder.mjs')).href),
    import(pathToFileURL(join(root, 'lib', 'llm', 'phase1-routing.mjs')).href),
    import(pathToFileURL(join(root, 'lib', 'llm', 'phase2-plan.mjs')).href),
  ]);
  return { buildLLMContext, runPhase1Routing, runPhase2Plan };
}

// Only run main() when invoked directly (not when imported by unit tests).
const isDirectRun =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  process.argv[1]?.endsWith('run-eval.mjs');

if (isDirectRun) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err?.message ?? String(err), stack: err?.stack }));
    process.exit(1);
  });
}
