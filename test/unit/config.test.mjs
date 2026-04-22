// Unit tests for lib/config.mjs — label routing YAML loader + validator.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A3.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadLabelRouting,
  validateConfig,
  getRepoSuggestions,
} from '../../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG = join(__dirname, '..', '..', 'config', 'label-routing.yaml');

describe('config loader', () => {
  let tmp;
  const fixturePath = (content) => {
    tmp = mkdtempSync(join(tmpdir(), 'cfg-'));
    const p = join(tmp, 'label-routing.yaml');
    writeFileSync(p, content);
    return p;
  };

  afterEach(() => {
    if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = null; }
  });

  it('loads valid YAML', () => {
    const p = fixturePath(`
labels:
  K5:
    product: KEYPO
    primary_group: KEYPO
    known_exceptions:
      - llmprojects/keypo-agent
ignore_for_routing:
  - P1_高
`);
    const cfg = loadLabelRouting(p);
    expect(cfg.labels.K5.primary_group).toBe('KEYPO');
    expect(cfg.labels.K5.known_exceptions).toContain('llmprojects/keypo-agent');
    expect(cfg.ignore_for_routing).toContain('P1_高');
  });

  it('preserves unicode label keys', () => {
    const p = fixturePath(`
labels:
  信義:
    product: Xinyi
    primary_group: sinyi
`);
    const cfg = loadLabelRouting(p);
    expect(cfg.labels['信義'].primary_group).toBe('sinyi');
  });

  it('rejects malformed YAML with parse error', () => {
    // Unclosed quote + tab indent = guaranteed YAML syntax error
    const p = fixturePath('labels:\n\tK5: "unterminated');
    expect(() => loadLabelRouting(p)).toThrow();
  });

  it('rejects empty YAML file', () => {
    const p = fixturePath('');
    expect(() => loadLabelRouting(p)).toThrow(/empty|invalid/i);
  });

  it('loads real project config successfully', () => {
    // Integration: the actual config/label-routing.yaml must parse + validate.
    const cfg = loadLabelRouting(REAL_CONFIG);
    expect(() => validateConfig(cfg)).not.toThrow();
    expect(cfg.labels.K5).toBeDefined();
    expect(cfg.labels.Fanti.layers.crawler).toBeDefined();
  });
});

describe('validateConfig', () => {
  it('rejects config missing labels key', () => {
    expect(() => validateConfig({ other: 1 })).toThrow(/missing.*labels/i);
  });

  it('rejects null/non-object root', () => {
    expect(() => validateConfig(null)).toThrow();
    expect(() => validateConfig('string')).toThrow();
  });

  it('rejects Fanti without layers', () => {
    const cfg = {
      labels: { Fanti: { product: 'Fanti', primary_group: null } },
    };
    expect(() => validateConfig(cfg)).toThrow(/Fanti.*layers/i);
  });

  it('rejects label with neither primary_group nor layers', () => {
    const cfg = { labels: { X: { product: 'X' } } };
    expect(() => validateConfig(cfg)).toThrow(/X/);
  });

  it('accepts label with primary_group and no layers', () => {
    const cfg = { labels: { K5: { product: 'KEYPO', primary_group: 'KEYPO' } } };
    expect(() => validateConfig(cfg)).not.toThrow();
  });
});

describe('getRepoSuggestions', () => {
  const cfg = {
    labels: {
      K5: {
        product: 'KEYPO', primary_group: 'KEYPO',
        known_exceptions: ['llmprojects/keypo-agent'],
      },
      Fanti: {
        product: 'Fanti', primary_group: null,
        layers: {
          crawler: ['CrawlersV2/fanti-insights-api'],
          backend: ['cdp/fanti-insights-backend'],
        },
      },
    },
  };

  it('returns primary_group + exceptions for normal label', () => {
    const r = getRepoSuggestions(cfg, 'K5');
    expect(r.isKnownLabel).toBe(true);
    expect(r.primary_group).toBe('KEYPO');
    expect(r.known_exceptions).toEqual(['llmprojects/keypo-agent']);
  });

  it('returns layer-specific repos when label + layer specified', () => {
    const r = getRepoSuggestions(cfg, 'Fanti', 'crawler');
    expect(r.isKnownLabel).toBe(true);
    expect(r.primary).toEqual(['CrawlersV2/fanti-insights-api']);
  });

  it('marks unknown label as not known', () => {
    const r = getRepoSuggestions(cfg, 'NotALabel');
    expect(r.isKnownLabel).toBe(false);
  });

  it('falls back gracefully when Fanti layer not given', () => {
    const r = getRepoSuggestions(cfg, 'Fanti');
    expect(r.isKnownLabel).toBe(true);
    // No primary_group, no layer selected → caller must handle
    expect(r.primary_group).toBe(null);
  });
});
