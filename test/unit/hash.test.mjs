// Unit tests for lib/hash.mjs — deterministic issue content hashing.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task A4.

import { describe, it, expect } from 'vitest';
import { hashIssueContent } from '../../lib/hash.mjs';

describe('hashIssueContent', () => {
  it('is deterministic for same input', () => {
    const a = { labels: ['K5', 'P1_高'], description: 'hi', state: 'opened' };
    expect(hashIssueContent(a)).toBe(hashIssueContent(a));
  });

  it('is order-independent for labels', () => {
    const a = hashIssueContent({ labels: ['K5', 'Bug'], description: 'x', state: 'opened' });
    const b = hashIssueContent({ labels: ['Bug', 'K5'], description: 'x', state: 'opened' });
    expect(a).toBe(b);
  });

  it('changes when description changes', () => {
    const a = hashIssueContent({ labels: [], description: 'a', state: 'opened' });
    const b = hashIssueContent({ labels: [], description: 'b', state: 'opened' });
    expect(a).not.toBe(b);
  });

  it('changes when state changes (opened → closed)', () => {
    const a = hashIssueContent({ labels: [], description: 'x', state: 'opened' });
    const b = hashIssueContent({ labels: [], description: 'x', state: 'closed' });
    expect(a).not.toBe(b);
  });

  it('changes when labels change', () => {
    const a = hashIssueContent({ labels: ['K5'], description: 'x', state: 'opened' });
    const b = hashIssueContent({ labels: ['K5', 'Bug'], description: 'x', state: 'opened' });
    expect(a).not.toBe(b);
  });

  it('ignores title (not in hash input)', () => {
    const a = hashIssueContent({ labels: [], description: 'x', state: 'opened', title: 'A' });
    const b = hashIssueContent({ labels: [], description: 'x', state: 'opened', title: 'B' });
    expect(a).toBe(b);
  });

  it('handles missing fields with defaults', () => {
    // All defaults: [], '', 'opened'
    const h1 = hashIssueContent({});
    const h2 = hashIssueContent({ labels: [], description: '', state: 'opened' });
    expect(h1).toBe(h2);
  });

  it('returns 64-char hex sha256', () => {
    const h = hashIssueContent({ labels: [], description: 'x', state: 'opened' });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles unicode in description', () => {
    const a = hashIssueContent({ labels: [], description: '付款失敗 🔴', state: 'opened' });
    const b = hashIssueContent({ labels: [], description: '付款失敗 🔴', state: 'opened' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
