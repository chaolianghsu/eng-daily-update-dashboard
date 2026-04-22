// Unit tests for lib/ground-truth-extractor.mjs — Eval v2 Phase I
// See docs/superpowers/plans/2026-04-22-issue-routing.md (Eval v2 addendum).
//
// Pure-logic tests only — no network, no LLM, no FS.

import { describe, it, expect } from 'vitest';
import {
  extractMrCrossRefs,
  extractAssigneeHeuristic,
  classifyIssueOutcome,
  buildLLMExtractorPrompt,
  parseLLMExtractorOutput,
  combineSignals,
  buildFixtureJson,
  anonymizeIssue,
  EXTRACTOR_TOOL,
} from '../../lib/ground-truth-extractor.mjs';

// ---- extractMrCrossRefs ------------------------------------------------------

describe('extractMrCrossRefs', () => {
  it('extracts single MR cross-ref from system note', () => {
    const notes = [
      { system: true, body: 'mentioned in merge request llmprojects/keypo-agent!42' },
    ];
    const r = extractMrCrossRefs(notes);
    expect(r.confidence).toBe('high');
    expect([...r.repos]).toEqual(['llmprojects/keypo-agent']);
  });

  it('extracts multiple distinct repos', () => {
    const notes = [
      { system: true, body: 'mentioned in merge request KEYPO/keypo_web!100' },
      { system: true, body: 'mentioned in merge request llmprojects/keypo-agent!200' },
    ];
    const r = extractMrCrossRefs(notes);
    expect(r.repos.size).toBe(2);
    expect(r.repos.has('KEYPO/keypo_web')).toBe(true);
    expect(r.repos.has('llmprojects/keypo-agent')).toBe(true);
  });

  it('handles deeply nested group paths', () => {
    const notes = [
      { system: true, body: 'mentioned in merge request techcenter/reportcenter/sub!9' },
    ];
    const r = extractMrCrossRefs(notes);
    expect(r.repos.has('techcenter/reportcenter/sub')).toBe(true);
  });

  it('ignores non-system notes even if they look like cross-refs', () => {
    const notes = [
      { system: false, body: 'mentioned in merge request fake/repo!1' },
    ];
    const r = extractMrCrossRefs(notes);
    expect(r.repos.size).toBe(0);
    expect(r.confidence).toBe('none');
  });

  it('returns confidence none for empty input', () => {
    const r = extractMrCrossRefs([]);
    expect(r.repos.size).toBe(0);
    expect(r.confidence).toBe('none');
  });

  it('deduplicates same repo mentioned twice', () => {
    const notes = [
      { system: true, body: 'mentioned in merge request a/b!1' },
      { system: true, body: 'mentioned in merge request a/b!2' },
    ];
    const r = extractMrCrossRefs(notes);
    expect(r.repos.size).toBe(1);
  });
});

// ---- extractAssigneeHeuristic ------------------------------------------------

describe('extractAssigneeHeuristic', () => {
  it('returns none when no commit data provided', () => {
    const r = extractAssigneeHeuristic({
      issue: { assignee: { username: 'henry.lee' }, closed_at: '2026-04-10T00:00:00Z' },
      assigneeCommitsByRepo: null,
    });
    expect(r.confidence).toBe('none');
    expect(r.repos.size).toBe(0);
  });

  it('returns none when issue has no assignee', () => {
    const r = extractAssigneeHeuristic({
      issue: { assignee: null, closed_at: '2026-04-10T00:00:00Z' },
      assigneeCommitsByRepo: {},
    });
    expect(r.confidence).toBe('none');
  });
});

// ---- classifyIssueOutcome ----------------------------------------------------

describe('classifyIssueOutcome', () => {
  it('detects duplicate via keyword', () => {
    const r = classifyIssueOutcome({
      issue: { state: 'closed' },
      comments: [{ system: false, body: 'duplicate of #1234, closing' }],
    });
    expect(r).toBe('duplicate');
  });

  it('detects won\'t fix', () => {
    const r = classifyIssueOutcome({
      issue: { state: 'closed' },
      comments: [{ system: false, body: 'won\'t fix — out of scope' }],
    });
    expect(r).toBe('wont_fix');
  });

  it('detects customer error', () => {
    const r = classifyIssueOutcome({
      issue: { state: 'closed' },
      comments: [{ system: false, body: '這是使用者操作錯誤,不是 bug' }],
    });
    expect(r).toBe('customer_error');
  });

  it('detects likely fixed via zh keywords', () => {
    const r = classifyIssueOutcome({
      issue: { state: 'closed' },
      comments: [{ system: false, body: '已修正,請測試' }],
    });
    expect(r).toBe('likely_fixed');
  });

  it('returns unclear for closed issue with no signal comments', () => {
    const r = classifyIssueOutcome({
      issue: { state: 'closed' },
      comments: [{ system: false, body: '感謝回報' }],
    });
    expect(r).toBe('unclear');
  });

  it('likely_fixed when system note confirms closure after merge', () => {
    const r = classifyIssueOutcome({
      issue: { state: 'closed' },
      comments: [
        { system: true, body: 'mentioned in merge request a/b!1' },
        { system: true, body: 'closed' },
      ],
    });
    expect(r).toBe('likely_fixed');
  });
});

// ---- buildLLMExtractorPrompt -------------------------------------------------

describe('buildLLMExtractorPrompt', () => {
  it('includes issue body and label config context', () => {
    const prompt = buildLLMExtractorPrompt({
      issue: {
        iid: 3084,
        title: 'keypo agent 壞掉',
        description: '使用者回報...',
        labels: ['K5', 'P1_高'],
        project_path: 'techcenter/reportcenter',
      },
      comments: [{ body: '已修正在 keypo-agent', system: false }],
      labelConfig: {
        product: 'KEYPO',
        primary_group: 'KEYPO',
        known_exceptions: ['llmprojects/keypo-agent'],
      },
    });
    expect(prompt).toContain('3084');
    expect(prompt).toContain('keypo agent 壞掉');
    expect(prompt).toContain('K5');
    expect(prompt).toContain('KEYPO');
    expect(prompt).toContain('llmprojects/keypo-agent');
    expect(prompt).toContain('已修正在 keypo-agent');
    // zh-TW instruction present
    expect(prompt).toMatch(/繁體中文|zh-TW|extract_ground_truth/i);
  });

  it('handles empty comments gracefully', () => {
    const prompt = buildLLMExtractorPrompt({
      issue: { iid: 1, title: 't', description: 'd', labels: [], project_path: 'a/b' },
      comments: [],
      labelConfig: null,
    });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
  });
});

// ---- parseLLMExtractorOutput -------------------------------------------------

describe('parseLLMExtractorOutput', () => {
  it('parses valid tool_use input', () => {
    const raw = {
      type: 'tool_use',
      name: 'extract_ground_truth',
      input: {
        outcome: 'likely_fixed',
        fix_repos: ['llmprojects/keypo-agent'],
        primary_repo: 'llmprojects/keypo-agent',
        confidence: 'high',
        reasoning: 'MR 引用明確',
      },
    };
    const r = parseLLMExtractorOutput(raw);
    expect(r.outcome).toBe('likely_fixed');
    expect([...r.repos]).toEqual(['llmprojects/keypo-agent']);
    expect(r.confidence).toBe('high');
    expect(r.reason).toBe('MR 引用明確');
  });

  it('throws when missing outcome', () => {
    expect(() =>
      parseLLMExtractorOutput({
        type: 'tool_use',
        name: 'extract_ground_truth',
        input: { fix_repos: [], confidence: 'low', reasoning: 'x' },
      })
    ).toThrow(/outcome/i);
  });

  it('throws when missing confidence', () => {
    expect(() =>
      parseLLMExtractorOutput({
        type: 'tool_use',
        name: 'extract_ground_truth',
        input: { outcome: 'unclear', fix_repos: [], reasoning: 'x' },
      })
    ).toThrow(/confidence/i);
  });

  it('throws for non-object input', () => {
    expect(() => parseLLMExtractorOutput(null)).toThrow();
    expect(() => parseLLMExtractorOutput({ type: 'text' })).toThrow();
  });
});

// ---- combineSignals ----------------------------------------------------------

describe('combineSignals', () => {
  const agreedRepo = 'llmprojects/keypo-agent';

  it('promotes to GOLD when 2 of 3 signals agree on a repo and outcome is likely_fixed', () => {
    const r = combineSignals({
      mrRefs: { repos: new Set([agreedRepo]), confidence: 'high' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none' },
      llmExtractor: {
        repos: new Set([agreedRepo]),
        outcome: 'likely_fixed',
        confidence: 'high',
        reason: 'ok',
      },
    });
    expect(r.tier).toBe('GOLD');
    expect(r.fix_repos).toContain(agreedRepo);
    expect(r.primary_repo).toBe(agreedRepo);
  });

  it('promotes to SILVER when only 1 high-confidence signal with no contradiction', () => {
    const r = combineSignals({
      mrRefs: { repos: new Set(), confidence: 'none' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none' },
      llmExtractor: {
        repos: new Set([agreedRepo]),
        outcome: 'likely_fixed',
        confidence: 'high',
        reason: 'confident',
      },
    });
    expect(r.tier).toBe('SILVER');
  });

  it('returns BRONZE for weak/contradictory signals', () => {
    const r = combineSignals({
      mrRefs: { repos: new Set(['a/b']), confidence: 'high' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none' },
      llmExtractor: {
        repos: new Set(['c/d']),
        outcome: 'likely_fixed',
        confidence: 'low',
        reason: 'unsure',
      },
    });
    expect(r.tier).toBe('BRONZE');
  });

  it('returns SKIP when outcome is duplicate regardless of repo signals', () => {
    const r = combineSignals({
      mrRefs: { repos: new Set([agreedRepo]), confidence: 'high' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none' },
      llmExtractor: {
        repos: new Set([agreedRepo]),
        outcome: 'duplicate',
        confidence: 'high',
        reason: 'dup',
      },
    });
    expect(r.tier).toBe('SKIP');
  });

  it('returns SKIP when outcome is wont_fix', () => {
    const r = combineSignals({
      mrRefs: { repos: new Set(), confidence: 'none' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none' },
      llmExtractor: {
        repos: new Set(),
        outcome: 'wont_fix',
        confidence: 'high',
        reason: 'wontfix',
      },
    });
    expect(r.tier).toBe('SKIP');
  });

  it('returns SKIP when outcome is customer_error', () => {
    const r = combineSignals({
      mrRefs: { repos: new Set(), confidence: 'none' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none' },
      llmExtractor: {
        repos: new Set(),
        outcome: 'customer_error',
        confidence: 'med',
        reason: 'pebkac',
      },
    });
    expect(r.tier).toBe('SKIP');
  });
});

// ---- anonymizeIssue ----------------------------------------------------------

describe('anonymizeIssue', () => {
  it('does not break happy-path issues with no customer names', () => {
    const input = {
      iid: 42,
      title: 'agent 壞掉',
      description: 'keypo agent turn limit',
      labels: ['K5'],
    };
    const out = anonymizeIssue(input);
    expect(out.iid).toBe(42);
    expect(out.title).toBe('agent 壞掉');
    expect(out.description).toContain('keypo');
  });

  it('masks customer names appearing in parens', () => {
    const out = anonymizeIssue({
      iid: 1,
      title: '(嗶嗶客戶) 無法匯出',
      description: '某電商 (嗶嗶) 客戶反映...',
      labels: [],
    });
    // The customer-parens pattern should be masked in some form.
    expect(out.title).not.toContain('嗶嗶客戶');
    expect(out.description).not.toContain('(嗶嗶)');
  });

  it('preserves structure (keys) of input issue', () => {
    const out = anonymizeIssue({
      iid: 1,
      title: 'x',
      description: 'y',
      labels: ['K5'],
      project_path: 'a/b',
    });
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['iid', 'title', 'description', 'labels', 'project_path'])
    );
  });
});

// ---- buildFixtureJson --------------------------------------------------------

describe('buildFixtureJson', () => {
  it('populates provenance with signal details', () => {
    const issue = {
      iid: 3084,
      title: 'x',
      description: 'y',
      labels: ['K5'],
      state: 'closed',
      closed_at: '2026-04-10T00:00:00Z',
      project_path: 'techcenter/reportcenter',
      assignee: { username: 'henry.lee' },
    };
    const signals = {
      mrRefs: { repos: new Set(['llmprojects/keypo-agent']), confidence: 'high' },
      assigneeHeuristic: { repos: new Set(), confidence: 'none', reason: 'skipped' },
      llmExtractor: {
        repos: new Set(['llmprojects/keypo-agent']),
        outcome: 'likely_fixed',
        confidence: 'high',
        reason: '明確',
      },
    };
    const combined = {
      tier: 'GOLD',
      outcome: 'likely_fixed',
      fix_repos: ['llmprojects/keypo-agent'],
      primary_repo: 'llmprojects/keypo-agent',
      agreement_count: 2,
      promotion_rule: '2_of_3_agree',
    };
    const fx = buildFixtureJson({ issue, comments: [], signals, combinedResult: combined });
    expect(fx.tier).toBe('GOLD');
    expect(fx.issue.iid).toBe(3084);
    expect(fx.ground_truth.outcome).toBe('likely_fixed');
    expect(fx.ground_truth.primary_repo).toBe('llmprojects/keypo-agent');
    expect(fx.provenance.mr_cross_refs.signal).toBe('high');
    expect(fx.provenance.mr_cross_refs.repos).toEqual(['llmprojects/keypo-agent']);
    expect(fx.provenance.assignee_heuristic.signal).toBe('none');
    expect(fx.provenance.llm_extractor.signal).toBe('high');
    expect(fx.provenance.agreement_count).toBe(2);
    expect(fx.provenance.promotion_rule).toBe('2_of_3_agree');
    expect(fx.fixture_id).toMatch(/^k5-3084$/);
  });
});

// ---- EXTRACTOR_TOOL schema ---------------------------------------------------

describe('EXTRACTOR_TOOL schema', () => {
  it('has the required shape for Anthropic tool_use', () => {
    expect(EXTRACTOR_TOOL.name).toBe('extract_ground_truth');
    expect(EXTRACTOR_TOOL.input_schema.type).toBe('object');
    expect(EXTRACTOR_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['outcome', 'fix_repos', 'confidence', 'reasoning'])
    );
    expect(EXTRACTOR_TOOL.input_schema.properties.outcome.enum).toEqual(
      expect.arrayContaining(['likely_fixed', 'duplicate', 'wont_fix', 'customer_error', 'no_fix_needed', 'unclear'])
    );
    expect(EXTRACTOR_TOOL.input_schema.properties.confidence.enum).toEqual(
      expect.arrayContaining(['high', 'med', 'low'])
    );
  });
});
