// test/unit/eval-runner.test.mjs — unit tests for the eval runner comparison logic.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B4.

import { describe, it, expect } from 'vitest';
import {
  compareToExpected,
  lintFixture,
} from '../../test/eval/run-eval.mjs';

const basePhase1 = (overrides = {}) => ({
  layer: 'n/a',
  suggested_repos: ['llmprojects/keypo-agent'],
  suggested_assignees: ['henry.lee'],
  reasoning: '依歷史 issue 修過 keypo-agent',
  confidence: 0.75,
  caveats: [],
  ...overrides,
});

const basePhase2 = (overrides = {}) => ({
  summary: '使用者回報 agent 沒回覆。',
  plan_draft: ['重現問題', '檢查 turn limit', '寫 regression test'],
  ...overrides,
});

const baseExpected = (overrides = {}) => ({
  layer: 'n/a',
  expected_repos_any_of: ['llmprojects/keypo-agent', 'KEYPO/keypo-engine-api-v3'],
  expected_assignees_any_of: ['henry.lee', 'walt.peng'],
  min_confidence: 0.5,
  max_confidence: 1.0,
  plan_draft_required: true,
  ...overrides,
});

describe('compareToExpected', () => {
  it('passes when all expectations are met', () => {
    const result = compareToExpected(basePhase1(), basePhase2(), baseExpected());
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails when layer mismatches', () => {
    const result = compareToExpected(
      basePhase1({ layer: 'unsure' }),
      basePhase2(),
      baseExpected({ layer: 'crawler' })
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/layer mismatch/);
    expect(result.reasons.join(' ')).toMatch(/crawler/);
    expect(result.reasons.join(' ')).toMatch(/unsure/);
  });

  it('fails when no suggested_repos overlap expected_repos_any_of', () => {
    const result = compareToExpected(
      basePhase1({ suggested_repos: ['random/repo'] }),
      basePhase2(),
      baseExpected()
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/repo/i);
  });

  it('fails when no suggested_assignees overlap expected_assignees_any_of', () => {
    const result = compareToExpected(
      basePhase1({ suggested_assignees: ['bob'] }),
      basePhase2(),
      baseExpected()
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/assignee/i);
  });

  it('skips assignee check when expected_assignees_any_of is empty', () => {
    const result = compareToExpected(
      basePhase1({ suggested_assignees: ['nobody'] }),
      basePhase2(),
      baseExpected({ expected_assignees_any_of: [] })
    );
    expect(result.pass).toBe(true);
  });

  it('fails when confidence is below min_confidence', () => {
    const result = compareToExpected(
      basePhase1({ confidence: 0.2 }),
      basePhase2(),
      baseExpected({ min_confidence: 0.5 })
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/confidence/i);
  });

  it('fails when confidence is above max_confidence (e.g., unsure case expecting <0.5)', () => {
    const result = compareToExpected(
      basePhase1({ confidence: 0.8 }),
      { summary: '...', plan_draft: null },
      baseExpected({ max_confidence: 0.49, plan_draft_required: false })
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/confidence/i);
  });

  it('fails when plan_draft_required=true but plan_draft is null', () => {
    const result = compareToExpected(
      basePhase1(),
      { summary: 'x', plan_draft: null },
      baseExpected({ plan_draft_required: true })
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/plan_draft/);
  });

  it('fails when plan_draft_required=false but plan_draft is non-null', () => {
    const result = compareToExpected(
      basePhase1({ confidence: 0.3 }),
      { summary: 'x', plan_draft: ['step 1'] },
      baseExpected({
        min_confidence: 0.0,
        max_confidence: 0.49,
        plan_draft_required: false,
      })
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/plan_draft/);
  });

  it('skips layer check when expected.layer is undefined', () => {
    const exp = baseExpected();
    delete exp.layer;
    const result = compareToExpected(
      basePhase1({ layer: 'whatever' }),
      basePhase2(),
      exp
    );
    expect(result.pass).toBe(true);
  });

  it('handles phase2 = null when plan_draft_required is false', () => {
    const result = compareToExpected(
      basePhase1({ confidence: 0.3 }),
      null,
      baseExpected({
        min_confidence: 0.0,
        max_confidence: 0.49,
        plan_draft_required: false,
      })
    );
    expect(result.pass).toBe(true);
  });
});

describe('lintFixture', () => {
  const labelConfig = {
    labels: {
      K5: { product: 'KEYPO' },
      Fanti: { layers: { crawler: [], backend: [], ui: [], nginx: [] } },
    },
    ignore_for_routing: ['P1_高'],
  };

  const validFixture = () => ({
    name: 'k5-agent-001',
    issue: {
      iid: 3062,
      title: 'keypo agent 回覆失敗',
      description: '使用者回報 agent 不回訊息...',
      labels: ['K5', 'P1_高'],
      project_path: 'techcenter/reportcenter',
      state: 'closed',
    },
    similar_issues: [
      {
        iid: 2999,
        title: 'agent ran out of turns',
        labels: ['K5'],
        assignee: 'henry.lee',
        closing_excerpt: '修在 keypo-agent, 加 turn limit',
      },
    ],
    expected: {
      layer: 'n/a',
      expected_repos_any_of: ['llmprojects/keypo-agent'],
      expected_assignees_any_of: ['henry.lee'],
      min_confidence: 0.5,
      max_confidence: 1.0,
      plan_draft_required: true,
    },
  });

  it('passes for a well-formed fixture', () => {
    const result = lintFixture(validFixture(), labelConfig);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails when top-level field is missing', () => {
    const fixture = validFixture();
    delete fixture.expected;
    const result = lintFixture(fixture, labelConfig);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/expected/);
  });

  it('fails when issue.labels references an unknown product label', () => {
    const fixture = validFixture();
    fixture.issue.labels = ['NotARealLabel', 'P1_高'];
    const result = lintFixture(fixture, labelConfig);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/unknown label/i);
  });

  it('treats ignore_for_routing labels as valid', () => {
    const fixture = validFixture();
    fixture.issue.labels = ['K5', 'P1_高', 'Bug'];
    const labelConfigWithBug = {
      ...labelConfig,
      ignore_for_routing: ['P1_高', 'Bug'],
    };
    const result = lintFixture(fixture, labelConfigWithBug);
    expect(result.pass).toBe(true);
  });

  it('fails when Fanti fixture has invalid layer in expected', () => {
    const fixture = validFixture();
    fixture.issue.labels = ['Fanti'];
    fixture.expected.layer = 'not_a_layer';
    const result = lintFixture(fixture, labelConfig);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/layer/i);
  });
});
