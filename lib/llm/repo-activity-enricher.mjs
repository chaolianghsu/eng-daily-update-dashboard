// lib/llm/repo-activity-enricher.mjs — Phase 0.5 SPIKE helper.
//
// Fetches recent Merge Requests + commits for a list of candidate repos and
// formats them as a human-readable block that can be injected into the Phase 1
// routing prompt. Goal: give the LLM concrete, current signals ("repo X has an
// open MR whose title matches this issue") instead of only label-based guesses.
//
// This file is NEW for the Phase 0.5 spike — NOT imported by production code.
// It is a pure helper: the caller creates the GitLab client and passes it in.
//
// Responsibilities:
//   - Fetch open MRs (state=opened, order_by=updated_at) per repo
//   - Fetch recent commits (since=<date>) per repo
//   - Gracefully skip repos that 404/403 (continue — don't fail the whole run)
//   - Truncate descriptions / messages aggressively (we're budget-bound)
//   - Estimate token cost (chars/4) so the caller can trade off breadth vs depth
//
// Not responsible for:
//   - Deciding WHICH repos are candidates (caller reads label-routing.yaml)
//   - Injecting into the prompt (formatActivityForPrompt returns string; caller
//     decides where it goes)
//   - Production routing — this is SPIKE scope only

const DEFAULT_MR_LIMIT = 5;
const DEFAULT_COMMIT_LIMIT = 10;
const DEFAULT_CONCURRENCY = 5;

const MR_DESC_CHAR_LIMIT = 200;
const COMMIT_MSG_CHAR_LIMIT = 120;
const MR_TITLE_CHAR_LIMIT = 140;

/**
 * Fetch recent MR + commit activity for each candidate repo.
 *
 * @param {object} params
 * @param {{ apiCall?: Function }} [params.client] - object with an `apiCall(endpoint)` method
 * @param {Function} [params.apiCall] - or pass an apiCall function directly (takes precedence)
 * @param {string[]} params.candidateRepos - full project paths e.g. 'KEYPO/keypo-backend'
 * @param {string} params.sinceDate - ISO timestamp, commits since this date
 * @param {string} [params.untilDate] - ISO timestamp, commits until this date (optional upper bound).
 *   When provided, MR query switches to `state=all` + `updated_after/updated_before` window (for
 *   retrospective/historical eval). Without it, the default `state=opened` behavior is used
 *   (for current production use).
 * @param {number} [params.mrLimit=5]
 * @param {number} [params.commitLimit=10]
 * @param {number} [params.concurrency=5]
 * @param {(msg: string) => void} [params.warn] - warning logger
 * @returns {Promise<{
 *   byRepo: Record<string, {
 *     open_mrs: Array<{ iid: number, title: string, description_excerpt: string, updated_at: string }>,
 *     recent_commits: Array<{ short_id: string, message_excerpt: string, committed_date: string }>,
 *     error?: string,
 *   }>,
 *   total_tokens_estimate: number,
 *   fetched_at: string,
 * }>}
 */
export async function fetchRepoActivity({
  client,
  apiCall: apiCallParam,
  candidateRepos,
  sinceDate,
  untilDate,
  mrLimit = DEFAULT_MR_LIMIT,
  commitLimit = DEFAULT_COMMIT_LIMIT,
  concurrency = DEFAULT_CONCURRENCY,
  warn = () => {},
} = {}) {
  const apiCall =
    typeof apiCallParam === 'function'
      ? apiCallParam
      : client && typeof client.apiCall === 'function'
        ? client.apiCall.bind(client)
        : null;
  if (!apiCall) {
    throw new Error(
      'fetchRepoActivity: pass either `apiCall: Function` or `client.apiCall: Function`',
    );
  }
  if (!Array.isArray(candidateRepos)) {
    throw new Error('fetchRepoActivity: candidateRepos must be an array');
  }
  if (!sinceDate) {
    throw new Error('fetchRepoActivity: sinceDate is required');
  }

  const fetchedAt = new Date().toISOString();
  const byRepo = {};

  // Simple concurrency pool (bounded parallelism).
  const queue = [...candidateRepos];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const repo = queue.shift();
      if (!repo) return;
      try {
        const [openMrs, recentCommits] = await Promise.all([
          fetchOpenMRsForRepo(apiCall, repo, mrLimit, warn, sinceDate, untilDate),
          fetchRecentCommitsForRepo(apiCall, repo, sinceDate, commitLimit, warn, untilDate),
        ]);
        byRepo[repo] = {
          open_mrs: openMrs,
          recent_commits: recentCommits,
        };
      } catch (err) {
        // 4xx (e.g. 404/403) already swallowed below; this catches anything else.
        warn(`fetchRepoActivity: ${repo} unexpected error: ${err?.message ?? err}`);
        byRepo[repo] = {
          open_mrs: [],
          recent_commits: [],
          error: String(err?.message ?? err),
        };
      }
    }
  });
  await Promise.all(workers);

  const formatted = formatActivityForPrompt({ byRepo, fetched_at: fetchedAt });
  const total_tokens_estimate = Math.ceil((formatted?.length ?? 0) / 4);

  return {
    byRepo,
    total_tokens_estimate,
    fetched_at: fetchedAt,
  };
}

async function fetchOpenMRsForRepo(apiCall, repo, limit, warn, sinceDate, untilDate) {
  const encoded = encodeURIComponent(repo);
  // When an explicit untilDate is provided we're in retrospective/historical mode —
  // query all MR states updated within [since, until] so we catch MRs that were
  // already merged by "now". Without untilDate, keep the original production
  // behavior (currently-open MRs ordered by recency).
  const path = untilDate
    ? `/projects/${encoded}/merge_requests?state=all&order_by=updated_at&updated_after=${encodeURIComponent(sinceDate)}&updated_before=${encodeURIComponent(untilDate)}&per_page=${limit}`
    : `/projects/${encoded}/merge_requests?state=opened&order_by=updated_at&per_page=${limit}`;
  let raw;
  try {
    raw = await apiCall(path);
  } catch (err) {
    // 4xx from GitLabApiError → skip. Anything else bubbles up.
    if (err?.status >= 400 && err?.status < 500) {
      warn(`fetchRepoActivity: MR skip ${repo} (${err.status})`);
      return [];
    }
    throw err;
  }
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).map((mr) => ({
    iid: mr.iid,
    title: truncate(mr.title ?? '', MR_TITLE_CHAR_LIMIT),
    description_excerpt: truncate(mr.description ?? '', MR_DESC_CHAR_LIMIT),
    updated_at: mr.updated_at ?? '',
  }));
}

async function fetchRecentCommitsForRepo(apiCall, repo, sinceDate, limit, warn, untilDate) {
  const encoded = encodeURIComponent(repo);
  const untilParam = untilDate ? `&until=${encodeURIComponent(untilDate)}` : '';
  const path = `/projects/${encoded}/repository/commits?since=${encodeURIComponent(sinceDate)}${untilParam}&per_page=${limit}`;
  let raw;
  try {
    raw = await apiCall(path);
  } catch (err) {
    if (err?.status >= 400 && err?.status < 500) {
      warn(`fetchRepoActivity: commits skip ${repo} (${err.status})`);
      return [];
    }
    throw err;
  }
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, limit).map((c) => ({
    short_id: c.short_id ?? (c.id ? String(c.id).slice(0, 8) : ''),
    message_excerpt: truncate(firstLine(c.message ?? c.title ?? ''), COMMIT_MSG_CHAR_LIMIT),
    committed_date: c.committed_date ?? c.created_at ?? '',
  }));
}

function firstLine(s) {
  const i = s.indexOf('\n');
  return i < 0 ? s : s.slice(0, i);
}

function truncate(s, limit) {
  if (!s) return '';
  if (s.length <= limit) return s;
  return s.slice(0, limit).trimEnd() + '…';
}

/**
 * Format an activity payload as a prompt-friendly block.
 * Keeps it dense — blank MRs/commits rendered as "(none)" so the shape is
 * still legible but doesn't waste tokens.
 *
 * @param {{ byRepo: object, fetched_at?: string }} activity
 * @returns {string}
 */
export function formatActivityForPrompt(activity) {
  if (!activity || !activity.byRepo) return '';
  const repos = Object.keys(activity.byRepo);
  if (repos.length === 0) return '';

  const lines = ['=== RECENT REPO ACTIVITY (for routing context) ==='];
  lines.push('');

  for (const repo of repos) {
    const data = activity.byRepo[repo] ?? {};
    lines.push(`[${repo}]`);
    if (data.error) {
      lines.push(`  (fetch error: ${data.error})`);
      lines.push('');
      continue;
    }

    // Open MRs
    if (data.open_mrs && data.open_mrs.length > 0) {
      lines.push('  Open MRs:');
      for (const mr of data.open_mrs) {
        lines.push(`    !${mr.iid} "${mr.title}"`);
        if (mr.description_excerpt) {
          lines.push(`        ${mr.description_excerpt}`);
        }
      }
    } else {
      lines.push('  Open MRs: (none)');
    }

    // Recent commits
    if (data.recent_commits && data.recent_commits.length > 0) {
      lines.push('  Recent commits:');
      for (const c of data.recent_commits) {
        lines.push(`    ${c.short_id} ${c.message_excerpt}`);
      }
    } else {
      lines.push('  Recent commits: (none)');
    }
    lines.push('');
  }

  return lines.join('\n');
}
