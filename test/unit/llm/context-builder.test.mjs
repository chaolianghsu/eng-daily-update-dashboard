// Unit tests for lib/llm/context-builder.mjs — LLM input assembly for issue routing.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B1.

import { describe, it, expect } from 'vitest';
import { buildLLMContext, extractFantiLayers } from '../../../lib/llm/context-builder.mjs';

const baseIssue = () => ({
  id: 12345,
  project_path: 'techcenter/reportcenter',
  title: '報表匯出失敗',
  description: '使用者點擊匯出 CSV 時出現 500 錯誤。',
  labels: ['K5', 'P1_高'],
});

const baseConfig = () => ({
  labels: {
    K5: { primary_group: 'techcenter/reportcenter' },
    Fanti: {
      primary_group: null,
      layers: {
        crawler: ['CrawlersV2/fanti-scraper'],
        backend: ['bigdata/fanti-api'],
        ui: ['dailyview/fanti-ui'],
        nginx: ['infra/nginx-configs'],
        keypo_integration: ['bigdata/keypo-bridge'],
      },
    },
  },
  ignore_for_routing: ['P1_高', 'P2_中'],
});

describe('buildLLMContext', () => {
  it('passes through unchanged when input is small (happy path)', () => {
    const input = {
      new_issue: baseIssue(),
      similar_issues: [
        {
          iid: 100,
          title: '舊的匯出錯誤',
          labels: ['K5'],
          assignee: 'alice',
          closing_excerpt: '已修復匯出模組。',
          resolution_hint: 'fix in export.py',
        },
      ],
      label_config: baseConfig(),
    };
    const out = buildLLMContext(input);
    expect(out.new_issue.title).toBe('報表匯出失敗');
    expect(out.new_issue.description).toBe(input.new_issue.description);
    expect(out.similar_issues).toHaveLength(1);
    expect(out.similar_issues[0].closing_excerpt).toBe('已修復匯出模組。');
    expect(out.label_config).toEqual(baseConfig());
  });

  it('truncates long description to head(1500) + marker + tail(500)', () => {
    const head = 'H'.repeat(1500);
    const middle = 'M'.repeat(2000);
    const tail = 'T'.repeat(500);
    const issue = baseIssue();
    issue.description = head + middle + tail;

    const out = buildLLMContext({
      new_issue: issue,
      similar_issues: [],
      label_config: baseConfig(),
    });

    const desc = out.new_issue.description;
    expect(desc.startsWith('H'.repeat(1500))).toBe(true);
    expect(desc.endsWith('T'.repeat(500))).toBe(true);
    expect(desc).toContain('[truncated]');
    // Should NOT contain the middle 'M's
    expect(desc).not.toContain('M'.repeat(10));
  });

  it('does not truncate short descriptions (≤ 2000 chars)', () => {
    const issue = baseIssue();
    issue.description = 'x'.repeat(2000);
    const out = buildLLMContext({
      new_issue: issue,
      similar_issues: [],
      label_config: baseConfig(),
    });
    expect(out.new_issue.description).toBe('x'.repeat(2000));
    expect(out.new_issue.description).not.toContain('[truncated]');
  });

  it('truncates similar_issues closing_excerpt to last 500 chars', () => {
    const long = 'A'.repeat(100) + 'B'.repeat(600); // 700 chars total
    const out = buildLLMContext({
      new_issue: baseIssue(),
      similar_issues: [
        { iid: 1, title: 't', labels: [], assignee: 'x', closing_excerpt: long, resolution_hint: '' },
      ],
      label_config: baseConfig(),
    });
    const excerpt = out.similar_issues[0].closing_excerpt;
    expect(excerpt).toHaveLength(500);
    // Last 500 chars = all B's (since last 500 of long are all B)
    expect(excerpt).toBe('B'.repeat(500));
  });

  it('throws when new_issue is missing entirely', () => {
    expect(() => buildLLMContext({ similar_issues: [], label_config: baseConfig() }))
      .toThrow(/new_issue/);
  });

  it('throws with clear message when new_issue.title is missing', () => {
    const issue = baseIssue();
    delete issue.title;
    expect(() => buildLLMContext({
      new_issue: issue,
      similar_issues: [],
      label_config: baseConfig(),
    })).toThrow(/title/);
  });

  it('allows empty similar_issues array', () => {
    const out = buildLLMContext({
      new_issue: baseIssue(),
      similar_issues: [],
      label_config: baseConfig(),
    });
    expect(out.similar_issues).toEqual([]);
  });

  it('normalizes labels: trims whitespace and dedupes', () => {
    const issue = baseIssue();
    issue.labels = ['  K5 ', 'K5', 'P1_高', ' P1_高', '\tFanti'];
    const out = buildLLMContext({
      new_issue: issue,
      similar_issues: [
        { iid: 1, title: 't', labels: [' K5 ', 'K5', 'X'], assignee: 'a', closing_excerpt: '', resolution_hint: '' },
      ],
      label_config: baseConfig(),
    });
    expect(out.new_issue.labels).toEqual(['K5', 'P1_高', 'Fanti']);
    expect(out.similar_issues[0].labels).toEqual(['K5', 'X']);
  });

  it('preserves unicode characters in description', () => {
    const issue = baseIssue();
    issue.description = '中文描述 🚨 emoji + ascii + 繁體中文';
    const out = buildLLMContext({
      new_issue: issue,
      similar_issues: [],
      label_config: baseConfig(),
    });
    expect(out.new_issue.description).toBe('中文描述 🚨 emoji + ascii + 繁體中文');
  });

  it('throws when total context exceeds 16K chars', () => {
    const huge = 'z'.repeat(2000); // within per-field truncation but we need total overflow
    // Stuff label_config with huge payload to blow past 16K total
    const cfg = baseConfig();
    cfg.labels.Huge = { primary_group: 'x', notes: 'q'.repeat(18000) };
    expect(() => buildLLMContext({
      new_issue: { ...baseIssue(), description: huge },
      similar_issues: [],
      label_config: cfg,
    })).toThrow(/16K|16000|oversized|exceeds/i);
  });
});

describe('extractFantiLayers', () => {
  it('returns the layers object when Fanti is in config', () => {
    const layers = extractFantiLayers(baseConfig());
    expect(layers).toEqual({
      crawler: ['CrawlersV2/fanti-scraper'],
      backend: ['bigdata/fanti-api'],
      ui: ['dailyview/fanti-ui'],
      nginx: ['infra/nginx-configs'],
      keypo_integration: ['bigdata/keypo-bridge'],
    });
  });

  it('returns null when Fanti is not in config', () => {
    const cfg = { labels: { K5: { primary_group: 'x' } } };
    expect(extractFantiLayers(cfg)).toBeNull();
  });

  it('returns null when Fanti exists but has no layers', () => {
    const cfg = { labels: { Fanti: { primary_group: 'some/group' } } };
    expect(extractFantiLayers(cfg)).toBeNull();
  });

  it('returns null for missing/empty config', () => {
    expect(extractFantiLayers(null)).toBeNull();
    expect(extractFantiLayers({})).toBeNull();
    expect(extractFantiLayers({ labels: {} })).toBeNull();
  });
});
