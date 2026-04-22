#!/usr/bin/env node
// validate-signal-2.mjs — diagnostic for signal 2 (assignee heuristic) coverage
// on ALL K5 closed issues. NOT a fixture producer; outputs raw signal data for
// analysis so we can decide if signal 2 is worth productionizing.
//
// For each closed K5 issue:
//   - signal 1: MR cross-refs from system notes
//   - signal 2: assignee commits in top-20 KEYPO candidate repos ±3d of close
//   - No LLM calls (fast, free)
// Outputs: JSON + markdown report with aggregate + per-issue.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const cfg = JSON.parse(readFileSync(join(REPO_ROOT, 'gitlab-config.json'), 'utf8'));
const headers = { 'PRIVATE-TOKEN': cfg.token };

async function api(path) {
  const r = await fetch(`${cfg.baseUrl}/api/v4${path}`, { headers });
  if (!r.ok) return null;
  return r.json();
}

const DAY = 86400;
const WINDOW_SECONDS = 3 * DAY;

// Candidate repos for K5 — hardcoded from label-routing.yaml as of 2026-04-22
const K5_CANDIDATES = [
  'llmprojects/keypo-agent',
  'KEYPO/keypo-backend',
  'KEYPO/keypo-frontend-2023',
  'KEYPO/keypo-engine-api',
  'KEYPO/keypo-engine/keypo-engine-api-v3',
  'KEYPO/keypo-engine/keypo-engine-api-gateway',
  'KEYPO/keypo-engine/on-premises-api-gateway',
  'KEYPO/keypo-engine/keypo-engine-gateway',
  'KEYPO/keypo-engine/data-collector',
  'KEYPO/keypo-engine/analyzer-and-qtool-testcase',
  'KEYPO/keypo-engine/qtool',
  'KEYPO/keypo-q-huaan-v2',
  'KEYPO/keypo-newsletter',
  'KEYPO/keypo-international-website',
  'KEYPO/line-notify-backend-2023',
  'KEYPO/keypo-data-api',
  'KEYPO/keypo-engine-layer',
  'KEYPO/keypo-questionnaire',
  'KEYPO/keypo-micro-portal',
  'KEYPO/keypo-status-check',
];

// Signal 1 regex (from ground-truth-extractor.mjs)
const MR_REGEX = /mentioned in merge request ([\w\-\/]+)!\d+/gi;
const COMMIT_REGEX = /mentioned in commit ([\w\-\/]+)@[0-9a-f]+/gi;

function extractMrCrossRefs(systemNotes) {
  const repos = new Set();
  for (const n of systemNotes || []) {
    const body = n.body || '';
    let m;
    while ((m = MR_REGEX.exec(body)) !== null) repos.add(m[1]);
    MR_REGEX.lastIndex = 0;
    while ((m = COMMIT_REGEX.exec(body)) !== null) repos.add(m[1]);
    COMMIT_REGEX.lastIndex = 0;
  }
  return [...repos];
}

async function main() {
  console.log('[validate-signal-2] Starting...');

  // 1. Fetch project ids
  const projIds = {};
  for (const path of ['techcenter/reportcenter', 'techcenter/reportcenter_confidential']) {
    const p = await api('/projects/' + encodeURIComponent(path));
    projIds[path] = p.id;
  }

  // 2. Fetch all closed K5 issues since 2026-01-01
  const issues = [];
  for (const [path, pid] of Object.entries(projIds)) {
    const list = await api(`/projects/${pid}/issues?state=closed&labels=K5&per_page=100&created_after=2026-01-01T00:00:00Z`);
    for (const iss of list || []) {
      issues.push({ ...iss, project_path: path });
    }
  }
  console.log(`[validate-signal-2] Fetched ${issues.length} K5 closed issues`);

  // 3. Pre-fetch commits per candidate repo in date range 2025-12-20 → today (wider than issue range for window)
  const since = '2025-12-20T00:00:00Z';
  const repoCommits = new Map(); // repo -> Map<lowercase author_name, Array<unix_sec>>
  for (const repo of K5_CANDIDATES) {
    const pid = await api('/projects/' + encodeURIComponent(repo));
    if (!pid) { console.log(`  skip ${repo}: project not found`); continue; }
    // Fetch commits in date range (paginate)
    const authorMap = new Map();
    let page = 1;
    while (true) {
      const commits = await api(`/projects/${pid.id}/repository/commits?per_page=100&page=${page}&since=${since}&all=true`);
      if (!commits || commits.length === 0) break;
      for (const c of commits) {
        const author = (c.author_name || '').toLowerCase().trim();
        const ts = Math.floor(new Date(c.committed_date || c.created_at).getTime() / 1000);
        if (!authorMap.has(author)) authorMap.set(author, []);
        authorMap.get(author).push(ts);
      }
      if (commits.length < 100) break;
      page++;
      if (page > 20) break; // safety
    }
    repoCommits.set(repo, authorMap);
    console.log(`  ${repo}: ${[...authorMap.values()].reduce((n, a) => n + a.length, 0)} commits, ${authorMap.size} authors`);
  }

  // 4. For each issue: compute signal 1 + signal 2
  const results = [];
  for (const iss of issues) {
    const pid = projIds[iss.project_path];
    const notes = await api(`/projects/${pid}/issues/${iss.iid}/notes?per_page=100&sort=asc`);
    const sysNotes = (notes || []).filter((n) => n.system);

    const mrRepos = extractMrCrossRefs(sysNotes);

    // Signal 2: assignee commits in window
    const closedAt = iss.closed_at ? Math.floor(new Date(iss.closed_at).getTime() / 1000) : null;
    const assignee = iss.assignee?.username || iss.assignee?.name || null;
    const assigneeRepos = [];
    if (assignee && closedAt) {
      const key = assignee.toLowerCase().trim();
      // Try matching gitlab username against commit author names (may not be exact — we match by trying multiple forms)
      const memberMap = cfg.memberMap || {};
      // Resolve display names for this user from memberMap (reverse lookup)
      const nameCandidates = new Set([key]);
      // memberMap: { "gitlab-author-name": "display_name" } — find all entries with value=display_name or key=assignee
      for (const [authorName, displayName] of Object.entries(memberMap)) {
        if (authorName.toLowerCase() === key || (displayName || '').toLowerCase() === key) {
          nameCandidates.add(authorName.toLowerCase());
        }
      }

      for (const [repo, authorMap] of repoCommits.entries()) {
        let count = 0;
        for (const name of nameCandidates) {
          const commits = authorMap.get(name) || [];
          count += commits.filter((ts) => Math.abs(ts - closedAt) <= WINDOW_SECONDS).length;
        }
        if (count > 0) assigneeRepos.push({ repo, count });
      }
    }

    // Classify signal 2 confidence
    let sig2Conf = 'none';
    if (assigneeRepos.some((r) => r.count >= 2)) sig2Conf = 'high';
    else if (assigneeRepos.length === 1) sig2Conf = 'med';
    else if (assigneeRepos.length > 1) sig2Conf = 'low';

    // Agreement check
    const sig1Set = new Set(mrRepos);
    const sig2Set = new Set(assigneeRepos.map((r) => r.repo));
    const intersection = [...sig1Set].filter((r) => sig2Set.has(r));
    const agree = sig1Set.size > 0 && sig2Set.size > 0 && intersection.length > 0;

    results.push({
      iid: iss.iid,
      title: iss.title,
      closed_at: iss.closed_at,
      assignee,
      labels: iss.labels,
      sig1: { repos: mrRepos, fires: mrRepos.length > 0 },
      sig2: { repos: assigneeRepos, confidence: sig2Conf, fires: sig2Conf !== 'none' },
      agreement: agree,
      intersection,
    });
  }

  // 5. Aggregate
  const agg = {
    total: results.length,
    sig1_fires: results.filter((r) => r.sig1.fires).length,
    sig2_fires: results.filter((r) => r.sig2.fires).length,
    both_fire: results.filter((r) => r.sig1.fires && r.sig2.fires).length,
    both_fire_and_agree: results.filter((r) => r.sig1.fires && r.sig2.fires && r.agreement).length,
    only_sig1: results.filter((r) => r.sig1.fires && !r.sig2.fires).length,
    only_sig2: results.filter((r) => !r.sig1.fires && r.sig2.fires).length,
    neither: results.filter((r) => !r.sig1.fires && !r.sig2.fires).length,
  };

  console.log('\n=== AGGREGATE ===');
  console.log(JSON.stringify(agg, null, 2));

  // 6. Write output
  const outDir = join(REPO_ROOT, 'test/eval/diagnostics');
  const jsonOut = join(outDir, 'signal-validation-K5-20260422.json');
  writeFileSync(jsonOut, JSON.stringify({ aggregate: agg, per_issue: results }, null, 2));
  console.log(`\nJSON → ${jsonOut}`);

  // Markdown report
  const mdLines = [
    '# Signal 2 Validation Report — K5',
    '',
    `Date: 2026-04-22`,
    `Source: \`scripts/validate-signal-2.mjs\``,
    '',
    '## Aggregate',
    '',
    '| Metric | Count | % |',
    '|---|---|---|',
    `| Total K5 closed issues (Jan 1+) | ${agg.total} | 100% |`,
    `| Signal 1 (MR cross-ref) fires | ${agg.sig1_fires} | ${(100 * agg.sig1_fires / agg.total).toFixed(1)}% |`,
    `| Signal 2 (assignee commits) fires | ${agg.sig2_fires} | ${(100 * agg.sig2_fires / agg.total).toFixed(1)}% |`,
    `| Both fire | ${agg.both_fire} | ${(100 * agg.both_fire / agg.total).toFixed(1)}% |`,
    `| Both fire AND agree on ≥1 repo | ${agg.both_fire_and_agree} | ${(100 * agg.both_fire_and_agree / agg.total).toFixed(1)}% |`,
    `| Only signal 1 | ${agg.only_sig1} | ${(100 * agg.only_sig1 / agg.total).toFixed(1)}% |`,
    `| Only signal 2 | ${agg.only_sig2} | ${(100 * agg.only_sig2 / agg.total).toFixed(1)}% |`,
    `| Neither | ${agg.neither} | ${(100 * agg.neither / agg.total).toFixed(1)}% |`,
    '',
    '## Interpretation',
    '',
    agg.both_fire_and_agree >= 10
      ? `- ✅ Signal 2 meaningfully extends ground truth: ${agg.both_fire_and_agree} issues would get GOLD tier (was 3 with signal 1 alone).`
      : `- ⚠️ Signal 2 agreement with signal 1 is sparse (${agg.both_fire_and_agree}). Promotion rule based on 2/3 agreement would only add ~${Math.max(0, agg.both_fire_and_agree - 3)} GOLD beyond signal 1 baseline.`,
    agg.only_sig2 >= 20
      ? `- 🟡 Signal 2 also fires on ${agg.only_sig2} issues where signal 1 is silent. These are SILVER candidates if LLM agrees on outcome.`
      : `- Signal 2 alone (no sig1) fires on ${agg.only_sig2} issues — smaller than expected.`,
    agg.sig2_fires < 30
      ? `- 🚨 Assignee matching may be under-counting. Memberships between GitLab username and commit author_name aren't matching well. Check memberMap coverage.`
      : '',
    '',
    '## Per-issue sample (first 20)',
    '',
    '| iid | sig1 repos | sig2 repos | agree? | assignee |',
    '|---|---|---|---|---|',
    ...results.slice(0, 20).map((r) => {
      const sig1 = r.sig1.repos.length > 0 ? r.sig1.repos.join(', ') : '—';
      const sig2 = r.sig2.repos.length > 0 ? r.sig2.repos.map((x) => `${x.repo}×${x.count}`).join(', ') : '—';
      return `| #${r.iid} | ${sig1} | ${sig2} | ${r.agreement ? '✅' : '—'} | ${r.assignee || '(none)'} |`;
    }),
  ].filter(Boolean).join('\n');

  const mdOut = join(outDir, 'signal-validation-K5-20260422.md');
  writeFileSync(mdOut, mdLines);
  console.log(`MD   → ${mdOut}`);
}

main().catch((e) => {
  console.error('[validate-signal-2] FATAL', e);
  process.exit(1);
});
