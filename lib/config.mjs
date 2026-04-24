// lib/config.mjs — label routing YAML loader + validator + query helper.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A3.
//
// Contract:
//   - labels.<name>.primary_group: group/namespace in GitLab, OR null (→ layers required)
//   - labels.<name>.known_exceptions: string[] of "group/project" paths
//   - labels.<name>.layers.<layer>: string[] for cross-group products (e.g. Fanti)
//   - ignore_for_routing: labels that are type/priority, not product signal

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

export function loadLabelRouting(path) {
  const raw = readFileSync(path, 'utf8');
  const cfg = parseYaml(raw);
  if (cfg === null || cfg === undefined) {
    throw new Error(`config: empty or invalid YAML at ${path}`);
  }
  return cfg;
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error('config: root must be a plain object');
  }
  if (!cfg.labels || typeof cfg.labels !== 'object') {
    throw new Error('config: missing required key "labels"');
  }
  if (cfg.repo_descriptions !== undefined) {
    if (typeof cfg.repo_descriptions !== 'object' || Array.isArray(cfg.repo_descriptions)) {
      throw new Error('config: repo_descriptions must be an object mapping repo path → description');
    }
    for (const [repo, desc] of Object.entries(cfg.repo_descriptions)) {
      if (typeof desc !== 'string' || !desc.trim()) {
        throw new Error(`config: repo_descriptions["${repo}"] must be a non-empty string`);
      }
    }
  }

  for (const [name, spec] of Object.entries(cfg.labels)) {
    if (!spec || typeof spec !== 'object') {
      throw new Error(`config: label "${name}" must be an object`);
    }

    const hasPrimary = typeof spec.primary_group === 'string';
    const hasLayers = spec.layers && typeof spec.layers === 'object';

    if (!hasPrimary && !hasLayers) {
      // primary_group === null is allowed ONLY if layers present
      if (spec.primary_group === null && !hasLayers) {
        if (name === 'Fanti') {
          throw new Error(`config: Fanti requires layers (crawler / backend / ui / nginx / keypo_integration)`);
        }
        throw new Error(`config: label "${name}" with primary_group: null requires layers`);
      }
      throw new Error(`config: label "${name}" needs either primary_group (string) or layers (object)`);
    }

    if (hasLayers) {
      for (const [layerName, repos] of Object.entries(spec.layers)) {
        if (!Array.isArray(repos)) {
          throw new Error(`config: label "${name}" layer "${layerName}" must be an array of repo paths`);
        }
      }
    }

    if (spec.known_exceptions !== undefined && !Array.isArray(spec.known_exceptions)) {
      throw new Error(`config: label "${name}" known_exceptions must be an array`);
    }

    if (spec.default_assignees !== undefined) {
      if (!Array.isArray(spec.default_assignees)) {
        throw new Error(`config: label "${name}" default_assignees must be an array`);
      }
      for (const a of spec.default_assignees) {
        if (typeof a !== 'string' || !a.trim()) {
          throw new Error(`config: label "${name}" default_assignees entries must be non-empty strings`);
        }
      }
    }
  }

  return cfg;
}

/**
 * Query repo suggestions for a label.
 * - If label has `layers` and a layer is specified → returns that layer's repos as `primary`.
 * - Otherwise returns `{ primary_group, known_exceptions }` for the ranker to use.
 * - If label is not in config → returns `{ isKnownLabel: false }`.
 */
export function getRepoSuggestions(cfg, label, layer = null) {
  const spec = cfg?.labels?.[label];
  if (!spec) return { isKnownLabel: false };

  if (spec.layers && layer && spec.layers[layer]) {
    return {
      isKnownLabel: true,
      primary: spec.layers[layer],
      exceptions: [],
      product: spec.product,
    };
  }

  return {
    isKnownLabel: true,
    primary_group: spec.primary_group ?? null,
    known_exceptions: spec.known_exceptions ?? [],
    layers: spec.layers ?? null,
    product: spec.product,
  };
}
