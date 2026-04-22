// lib/ground-truth-extractor.mjs — Eval v2 Phase I
// Tiered-ensemble ground truth extractor: MR cross-refs + assignee heuristic
// (deferred) + LLM comment reader. Pure functions — callers wire IO.
//
// See docs/superpowers/plans/2026-04-22-issue-routing.md (Eval v2 addendum).
//
// Export surface:
//   extractMrCrossRefs(systemNotes)
//   extractAssigneeHeuristic({ issue, assigneeCommitsByRepo })
//   classifyIssueOutcome({ issue, comments })
//   buildLLMExtractorPrompt({ issue, comments, labelConfig })
//   parseLLMExtractorOutput(rawToolUse)
//   combineSignals({ mrRefs, assigneeHeuristic, llmExtractor })
//   buildFixtureJson({ issue, comments, signals, combinedResult })
//   anonymizeIssue(issue)
//   EXTRACTOR_TOOL

// ---- LLM tool schema --------------------------------------------------------

export const EXTRACTOR_TOOL = {
  name: 'extract_ground_truth',
  description: '從 closed issue 的 comments 推論實際解決方式',
  input_schema: {
    type: 'object',
    required: ['outcome', 'fix_repos', 'confidence', 'reasoning'],
    properties: {
      outcome: {
        type: 'string',
        enum: ['likely_fixed', 'duplicate', 'wont_fix', 'customer_error', 'no_fix_needed', 'unclear'],
      },
      fix_repos: {
        type: 'array',
        items: { type: 'string' },
        description: 'group/project paths mentioned as fix location. Empty if not determinable.',
      },
      primary_repo: {
        type: 'string',
        description: 'Single best-guess primary fix repo, or empty string if unclear',
      },
      confidence: { type: 'string', enum: ['high', 'med', 'low'] },
      reasoning: { type: 'string', description: '1-2 句 zh-TW 解釋判斷依據' },
    },
  },
};

// ---- Signal 1: MR cross-refs ------------------------------------------------

// GitLab system note format for cross-referenced merge requests:
//   "mentioned in merge request group/sub/proj!42"
// We match `group/.../proj!NUM` and capture the repo path (without the !NUM).
const MR_REF_RE = /mentioned in merge request ([\w./-]+)!(\d+)/g;

export function extractMrCrossRefs(systemNotes) {
  const repos = new Set();
  if (!Array.isArray(systemNotes)) {
    return { repos, confidence: 'none' };
  }
  for (const note of systemNotes) {
    if (!note || note.system !== true || typeof note.body !== 'string') continue;
    const body = note.body;
    for (const m of body.matchAll(MR_REF_RE)) {
      const repo = m[1];
      if (repo && repo.includes('/')) repos.add(repo);
    }
  }
  return { repos, confidence: repos.size > 0 ? 'high' : 'none' };
}

// ---- Signal 2: Assignee heuristic (v0: deferred) ----------------------------

// Cross-repo commit-fetching is expensive; v0 leaves this as a no-op.
// v1.1 will accept { repo: [ { sha, committed_date } ] } keyed by repo path
// and check for commits by assignee ±3 days from issue.closed_at.
export function extractAssigneeHeuristic({ issue, assigneeCommitsByRepo } = {}) {
  const repos = new Set();
  if (!issue || !issue.assignee) {
    return { repos, confidence: 'none', reason: 'no assignee' };
  }
  if (!assigneeCommitsByRepo || typeof assigneeCommitsByRepo !== 'object') {
    return { repos, confidence: 'none', reason: 'no commit data (v0: skipped)' };
  }
  // Future: count commits per repo within ±3 days of closed_at.
  // For now, keep signature pure + return none so combineSignals doesn't
  // spuriously reward this lane.
  return { repos, confidence: 'none', reason: 'v0: disabled' };
}

// ---- Outcome classifier (deterministic) -------------------------------------

// Ordered: duplicate > wont_fix > customer_error > likely_fixed > unclear.
// Checked in this order so "duplicate of" wins over "closed".
const DUPLICATE_PATTERNS = [
  /\bduplicate of\b/i,
  /\bdup(?:licate)?\s+of\s+#/i,
  /重複(?:的)?(?:issue|問題)?/,
  /與\s*#?\d+\s*重複/,
];
const WONT_FIX_PATTERNS = [
  /\bwon'?t\s*fix\b/i,
  /\bwontfix\b/i,
  /\bout of scope\b/i,
  /不會修/,
  /不修/,
  /暫不處理/,
];
const CUSTOMER_ERROR_PATTERNS = [
  /\bnot a bug\b/i,
  /\bworking as intended\b/i,
  /\bworks as designed\b/i,
  /使用者操作錯誤/,
  /操作錯誤/,
  /非\s*bug/,
  /不是\s*bug/,
  /使用者問題/,
];
const NO_FIX_NEEDED_PATTERNS = [
  /\bno fix needed\b/i,
  /\bno action required\b/i,
  /\balready (?:works|fixed)\b/i,
  /無需修正/,
  /已經正常/,
  /已恢復/,
];
const LIKELY_FIXED_PATTERNS = [
  /\bfixed in\b/i,
  /\bresolved in\b/i,
  /\bmerged\b/i,
  /\bclosing (?:as|after) fix\b/i,
  /已修(?:正|好|完|復|掉)/,
  /已補/,
  /修正了/,
  /修好了/,
  /修掉了/,
  /已處理/,
  /已上線/,
  /已 deploy/i,
];

function matchesAny(patterns, text) {
  return patterns.some((p) => p.test(text));
}

export function classifyIssueOutcome({ issue, comments } = {}) {
  const allText = (comments || [])
    .filter((c) => c && typeof c.body === 'string')
    .map((c) => c.body)
    .join('\n');

  if (matchesAny(DUPLICATE_PATTERNS, allText)) return 'duplicate';
  if (matchesAny(WONT_FIX_PATTERNS, allText)) return 'wont_fix';
  if (matchesAny(CUSTOMER_ERROR_PATTERNS, allText)) return 'customer_error';
  if (matchesAny(NO_FIX_NEEDED_PATTERNS, allText)) return 'no_fix_needed';
  if (matchesAny(LIKELY_FIXED_PATTERNS, allText)) return 'likely_fixed';

  // Fallback: if state is closed AND we saw any MR cross-ref system note,
  // lean likely_fixed. Otherwise unclear.
  const hasMrRef = (comments || []).some(
    (c) => c && c.system === true && typeof c.body === 'string' && /merge request [\w./-]+!\d+/.test(c.body),
  );
  const closedSystem = (comments || []).some(
    (c) => c && c.system === true && typeof c.body === 'string' && /\bclosed\b/i.test(c.body),
  );
  if (hasMrRef && closedSystem) return 'likely_fixed';

  return 'unclear';
}

// ---- LLM prompt builder ------------------------------------------------------

export function buildLLMExtractorPrompt({ issue, comments, labelConfig } = {}) {
  const userComments = (comments || [])
    .filter((c) => c && !c.system && typeof c.body === 'string')
    .map((c, i) => `[#${i + 1}] ${c.author?.username ?? c.author_username ?? '(unknown)'}: ${truncate(c.body, 1200)}`)
    .join('\n---\n');

  const systemNoteSummary = (comments || [])
    .filter((c) => c && c.system && typeof c.body === 'string')
    .map((c) => `- ${truncate(c.body, 300)}`)
    .join('\n');

  const labels = (issue?.labels || []).join(', ') || '(none)';

  const lc = labelConfig && typeof labelConfig === 'object'
    ? JSON.stringify(labelConfig, null, 2)
    : '(none supplied)';

  return [
    '你是一個 GitLab issue ground-truth 抽取助理。',
    '工作目標:讀完一個 closed issue 的 description + comments + system notes,',
    '推論這個 issue 實際上在哪個 repo 被修好 (或被 SKIP 掉),並用 extract_ground_truth tool 回傳結構化結果。',
    '',
    '判斷原則 (繁體中文 zh-TW):',
    '- outcome 必須選一個 enum 值。',
    '- fix_repos 只能包含 comments 或 system notes 有明確指出的 repo 路徑 (group/project 格式)。',
    '- 不確定時 confidence 給 low,絕對不要編造 repo。',
    '- reasoning 用 1-2 句 zh-TW 解釋判斷依據。',
    '',
    '=== ISSUE ===',
    `IID: ${issue?.iid ?? '(unknown)'}`,
    `Project: ${issue?.project_path ?? '(unknown)'}`,
    `Title: ${issue?.title ?? ''}`,
    `Labels: ${labels}`,
    `State: ${issue?.state ?? ''}`,
    `Closed at: ${issue?.closed_at ?? ''}`,
    'Description:',
    truncate(String(issue?.description ?? ''), 2000),
    '',
    '=== LABEL CONFIG (for this label) ===',
    lc,
    '',
    '=== USER COMMENTS ===',
    userComments || '(no user comments)',
    '',
    '=== SYSTEM NOTES (summary) ===',
    systemNoteSummary || '(no system notes)',
    '',
    '請 invoke extract_ground_truth tool 回傳你的判斷。',
  ].join('\n');
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  const chars = Array.from(s);
  if (chars.length <= n) return s;
  return chars.slice(0, n).join('') + '...[truncated]';
}

// ---- LLM output parser -------------------------------------------------------

const REQUIRED_FIELDS = ['outcome', 'fix_repos', 'confidence', 'reasoning'];

export function parseLLMExtractorOutput(rawToolUse) {
  if (!rawToolUse || typeof rawToolUse !== 'object') {
    throw new Error('parseLLMExtractorOutput: rawToolUse must be an object');
  }
  if (rawToolUse.type !== 'tool_use') {
    throw new Error(`parseLLMExtractorOutput: expected type=tool_use, got ${rawToolUse.type}`);
  }
  const input = rawToolUse.input;
  if (!input || typeof input !== 'object') {
    throw new Error('parseLLMExtractorOutput: tool_use.input is not an object');
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in input)) {
      throw new Error(`parseLLMExtractorOutput: missing required field "${f}"`);
    }
  }
  const repos = new Set(Array.isArray(input.fix_repos) ? input.fix_repos.filter((r) => typeof r === 'string' && r.includes('/')) : []);
  const primary = typeof input.primary_repo === 'string' && input.primary_repo.includes('/') ? input.primary_repo : null;
  return {
    repos,
    primary_repo: primary,
    outcome: input.outcome,
    confidence: input.confidence,
    reason: input.reasoning,
  };
}

// ---- Signal combiner ---------------------------------------------------------

const SKIP_OUTCOMES = new Set(['duplicate', 'wont_fix', 'customer_error']);

export function combineSignals({ mrRefs, assigneeHeuristic, llmExtractor } = {}) {
  const llmOutcome = llmExtractor?.outcome ?? 'unclear';

  // SKIP: outcome is duplicate/wont_fix/customer_error regardless of repo signals.
  if (SKIP_OUTCOMES.has(llmOutcome)) {
    return {
      tier: 'SKIP',
      outcome: llmOutcome,
      fix_repos: [],
      primary_repo: null,
      agreement_count: 0,
      promotion_rule: `skip_outcome:${llmOutcome}`,
    };
  }

  // Gather repo signals per lane.
  const lanes = [
    { name: 'mr', repos: [...(mrRefs?.repos ?? [])], conf: mrRefs?.confidence ?? 'none' },
    { name: 'assignee', repos: [...(assigneeHeuristic?.repos ?? [])], conf: assigneeHeuristic?.confidence ?? 'none' },
    { name: 'llm', repos: [...(llmExtractor?.repos ?? [])], conf: llmExtractor?.confidence ?? 'none' },
  ];

  // Count agreements per repo across lanes that actually contributed a signal.
  const repoVotes = new Map();
  for (const lane of lanes) {
    if (lane.conf === 'none') continue;
    const seen = new Set();
    for (const r of lane.repos) {
      if (seen.has(r)) continue;
      seen.add(r);
      repoVotes.set(r, (repoVotes.get(r) ?? 0) + 1);
    }
  }

  // Sort by vote count (desc), then alphabetic for determinism.
  const sortedRepos = [...repoVotes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topVoteCount = sortedRepos[0]?.[1] ?? 0;
  const topRepos = sortedRepos.filter(([, v]) => v === topVoteCount).map(([r]) => r);

  // GOLD: ≥2 of 3 signals agree on at least 1 repo AND outcome is likely_fixed.
  if (topVoteCount >= 2 && llmOutcome === 'likely_fixed') {
    return {
      tier: 'GOLD',
      outcome: llmOutcome,
      fix_repos: topRepos,
      primary_repo: topRepos[0] ?? null,
      agreement_count: topVoteCount,
      promotion_rule: '2_of_3_agree',
    };
  }

  // Detect contradictions: multiple lanes contributed repos but they don't
  // overlap. `topVoteCount === 1` with ≥2 lanes contributing ≥1 repo each.
  const contributingLanes = lanes.filter((l) => l.conf !== 'none' && l.repos.length > 0).length;
  const contradiction = contributingLanes >= 2 && topVoteCount === 1;

  // SILVER: 1 signal at HIGH confidence, no contradictions, outcome=likely_fixed.
  const highLanes = lanes.filter((l) => l.conf === 'high' && l.repos.length > 0);
  if (!contradiction && highLanes.length === 1 && llmOutcome === 'likely_fixed') {
    const lane = highLanes[0];
    const repos = [...new Set(lane.repos)];
    return {
      tier: 'SILVER',
      outcome: llmOutcome,
      fix_repos: repos,
      primary_repo: repos[0] ?? null,
      agreement_count: 1,
      promotion_rule: '1_high_no_contradiction',
    };
  }

  // Otherwise BRONZE.
  return {
    tier: 'BRONZE',
    outcome: llmOutcome,
    fix_repos: topRepos,
    primary_repo: topRepos[0] ?? null,
    agreement_count: topVoteCount,
    promotion_rule: contradiction ? 'contradiction' : 'weak_signals',
  };
}

// ---- Anonymization ----------------------------------------------------------

// Conservative blacklist — expand as needed. These are common Taiwan-style
// customer/brand markers that shouldn't leak into committed fixtures.
const CUSTOMER_NAME_BLACKLIST = [
  '嗶嗶',
  '嗶嗶客戶',
  '信義房屋',
  'SHOPLINE',
  '91APP',
  'momo',
  'Coupang',
  'PChome',
];

// Matches "(xxx客戶)" or "(xxx 客戶)" — parens with 客戶 inside.
const CUSTOMER_PAREN_RE = /[(（][^()（）]{1,30}?客戶[^()（）]{0,10}?[)）]/g;

export function anonymizeIssue(issue) {
  if (!issue || typeof issue !== 'object') return issue;
  const out = { ...issue };
  if (typeof out.title === 'string') out.title = anonymizeText(out.title);
  if (typeof out.description === 'string') out.description = anonymizeText(out.description);
  return out;
}

function anonymizeText(s) {
  let v = s;
  v = v.replace(CUSTOMER_PAREN_RE, '(某客戶)');
  for (const name of CUSTOMER_NAME_BLACKLIST) {
    // literal, case-insensitive, global
    const re = new RegExp(escapeRegex(name), 'gi');
    v = v.replace(re, '某客戶');
  }
  return v;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Fixture JSON shape ------------------------------------------------------

export function buildFixtureJson({ issue, comments, signals, combinedResult } = {}) {
  const anonymized = anonymizeIssue(issue || {});
  const labelForId = pickLabelForId(anonymized.labels ?? []);

  const fixtureId = `${labelForId.toLowerCase()}-${anonymized.iid ?? 'unknown'}`;

  const assignee =
    anonymized.assignee && typeof anonymized.assignee === 'object'
      ? anonymized.assignee.username ?? anonymized.assignee.name ?? null
      : anonymized.assignee ?? null;

  return {
    fixture_id: fixtureId,
    extraction_date: new Date().toISOString().slice(0, 10),
    tier: combinedResult?.tier ?? 'BRONZE',
    issue: {
      iid: anonymized.iid,
      project_path: anonymized.project_path ?? null,
      title: anonymized.title ?? '',
      description: anonymized.description ?? '',
      labels: anonymized.labels ?? [],
      state: anonymized.state ?? 'closed',
      closed_at: anonymized.closed_at ?? null,
      assignee,
    },
    ground_truth: {
      outcome: combinedResult?.outcome ?? 'unclear',
      fix_repos: combinedResult?.fix_repos ?? [],
      primary_repo: combinedResult?.primary_repo ?? null,
    },
    provenance: {
      mr_cross_refs: {
        signal: signals?.mrRefs?.confidence ?? 'none',
        repos: [...(signals?.mrRefs?.repos ?? [])],
      },
      assignee_heuristic: {
        signal: signals?.assigneeHeuristic?.confidence ?? 'none',
        reason:
          signals?.assigneeHeuristic?.reason ??
          'skipped v0 — cross-repo commit fetch TODO',
      },
      llm_extractor: {
        signal: signals?.llmExtractor?.confidence ?? 'none',
        repos: [...(signals?.llmExtractor?.repos ?? [])],
        reasoning: signals?.llmExtractor?.reason ?? '',
      },
      agreement_count: combinedResult?.agreement_count ?? 0,
      promotion_rule: combinedResult?.promotion_rule ?? 'unknown',
    },
    similar_context: null,
  };
}

function pickLabelForId(labels) {
  // Prefer known product labels for a readable fixture id prefix.
  const preferred = ['K5', 'BD', 'DV', 'Fanti', 'Data', '信義'];
  for (const p of preferred) {
    if (labels.includes(p)) return p;
  }
  return labels[0] ?? 'issue';
}
