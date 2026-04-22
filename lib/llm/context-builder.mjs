// lib/llm/context-builder.mjs — assembles input context object for Phase 1/2 routing LLM calls.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task B1.
//
// Responsibilities:
//   - Validate required new_issue fields (title/description/labels/id/project_path)
//   - Truncate description to head(1500) + marker + tail(500) when > 2000 chars
//   - Truncate each similar_issues[].closing_excerpt to last 500 chars
//   - Normalize labels: trim whitespace, dedupe, preserve order
//   - Enforce hard total-chars ceiling (~16K chars ≈ 4K tokens)
//
// Not responsible for:
//   - Building the prompt string (phase1-routing.mjs / phase2-plan.mjs own that)
//   - Calling the Anthropic SDK
//   - Choosing which similar issues to include (caller picks top-K)

const DESCRIPTION_MAX = 2000;
const DESCRIPTION_HEAD = 1500;
const DESCRIPTION_TAIL = 500;
const EXCERPT_MAX = 500;
const TOTAL_CHAR_LIMIT = 16_000; // ~4K tokens upper bound
const TRUNCATION_MARKER = '\n\n... [truncated] ...\n\n';

const REQUIRED_NEW_ISSUE_FIELDS = ['title', 'description', 'labels', 'id', 'project_path'];

/**
 * Assemble the LLM input context with validation, truncation, and normalization.
 * @param {{
 *   new_issue: { title: string, description: string, labels: string[], id: number|string, project_path: string },
 *   similar_issues?: Array<{ iid: number, title: string, labels: string[], assignee: string, closing_excerpt: string, resolution_hint?: string }>,
 *   label_config: object,
 * }} input
 * @returns {object} context with same shape, normalized and truncated
 */
export function buildLLMContext(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('buildLLMContext: input must be an object');
  }
  const { new_issue, similar_issues = [], label_config } = input;

  if (!new_issue || typeof new_issue !== 'object') {
    throw new Error('buildLLMContext: missing required "new_issue"');
  }
  for (const field of REQUIRED_NEW_ISSUE_FIELDS) {
    if (new_issue[field] === undefined || new_issue[field] === null) {
      throw new Error(`buildLLMContext: new_issue.${field} is required`);
    }
  }
  if (!Array.isArray(new_issue.labels)) {
    throw new Error('buildLLMContext: new_issue.labels must be an array');
  }
  if (!Array.isArray(similar_issues)) {
    throw new Error('buildLLMContext: similar_issues must be an array');
  }
  if (!label_config || typeof label_config !== 'object') {
    throw new Error('buildLLMContext: label_config is required');
  }

  const normalizedNewIssue = {
    ...new_issue,
    labels: normalizeLabels(new_issue.labels),
    description: truncateDescription(String(new_issue.description)),
  };

  const normalizedSimilar = similar_issues.map((s) => ({
    ...s,
    labels: normalizeLabels(s.labels || []),
    closing_excerpt: truncateExcerpt(String(s.closing_excerpt ?? '')),
  }));

  const context = {
    new_issue: normalizedNewIssue,
    similar_issues: normalizedSimilar,
    label_config,
  };

  const totalChars = estimateChars(context);
  if (totalChars > TOTAL_CHAR_LIMIT) {
    throw new Error(
      `buildLLMContext: oversized input — ${totalChars} chars exceeds 16K limit (≈4K tokens)`
    );
  }

  return context;
}

/**
 * Return Fanti's layers object from a label-routing config, or null if absent/empty.
 * Used by the Phase 1 LLM prompt to enumerate layer choices.
 * @param {object|null|undefined} labelConfig
 * @returns {object|null}
 */
export function extractFantiLayers(labelConfig) {
  const layers = labelConfig?.labels?.Fanti?.layers;
  if (!layers || typeof layers !== 'object') return null;
  if (Object.keys(layers).length === 0) return null;
  return layers;
}

// ---- helpers ----------------------------------------------------------------

function normalizeLabels(labels) {
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function truncateDescription(desc) {
  // Use Array.from for proper unicode character counting (surrogate pairs).
  const chars = Array.from(desc);
  if (chars.length <= DESCRIPTION_MAX) return desc;
  const head = chars.slice(0, DESCRIPTION_HEAD).join('');
  const tail = chars.slice(chars.length - DESCRIPTION_TAIL).join('');
  return head + TRUNCATION_MARKER + tail;
}

function truncateExcerpt(excerpt) {
  const chars = Array.from(excerpt);
  if (chars.length <= EXCERPT_MAX) return excerpt;
  return chars.slice(chars.length - EXCERPT_MAX).join('');
}

function estimateChars(context) {
  // JSON stringification is a reasonable proxy for prompt footprint.
  return JSON.stringify(context).length;
}
