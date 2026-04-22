// lib/hash.mjs — deterministic hash of issue content for dedup/idempotency.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A4.
//
// Intentionally excludes: title (often minor edits), comments (too noisy),
// assignee (we don't re-analyze just because reassigned).
// Included: labels (sorted for order-independence), description, state.

import { createHash } from 'crypto';

/**
 * @param {{ labels?: string[], description?: string, state?: string }} input
 * @returns {string} 64-char hex sha256
 */
export function hashIssueContent({ labels = [], description = '', state = 'opened' } = {}) {
  const normalized = [
    [...labels].sort().join(','),
    description,
    state,
  ].join('|');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
