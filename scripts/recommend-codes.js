#!/usr/bin/env node
'use strict';

/**
 * recommend-codes.js
 *
 * Suggest a [CODE] tag for each `code: null` work item in raw_data.json,
 * using deterministic rules + commit project lookup.
 *
 *   1. Direct token match in task description (validCodes key or label) → "rule"
 *   2. Meeting keyword auto-detect                                      → "meeting"
 *   3. Commit project prefix match                                       → "commit"
 *   4. No match                                                          → "none"
 *
 * Output is review-only JSON on stdout. Does NOT mutate raw_data.json.
 *
 * CLI:
 *   node scripts/recommend-codes.js [--date M/D[-M/D]] [--department <key>]
 *                                   [--member <name>] [--null-only|--all]
 *                                   [--limit N] [--raw <path>] [--commits <path>]
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Same keyword set parse-daily-updates.js uses to detect meeting hours.
const MEETING_KEYWORDS = /meeting|會議|週會|讀書會|例會|討論|分享會|sync|臨時會/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveMemberDepartment(member, centers) {
  if (!centers) return null;
  for (const [key, center] of Object.entries(centers)) {
    if (Array.isArray(center?.members) && center.members.includes(member)) {
      return key;
    }
  }
  return null;
}

function resolveValidCodes(data, department) {
  const centerCodes = data?.centers?.[department]?.validCodes;
  if (centerCodes && Object.keys(centerCodes).length > 0) return centerCodes;
  if (data?.validCodes) return data.validCodes;
  return {};
}

// Parse a date range string ("5/12" or "5/11-5/13") into { from, to } in M/D form.
// Returns null when no range is provided.
function parseDateRange(spec) {
  if (!spec) return null;
  const parts = spec.split('-').map(s => s.trim());
  if (parts.length === 1) return { from: parts[0], to: parts[0] };
  return { from: parts[0], to: parts[1] };
}

// Convert "M/D" → comparable integer for ordering within a year.
// (Same year assumed — sufficient for backfill windows.)
function dateKey(md) {
  const [m, d] = md.split('/').map(Number);
  return m * 100 + d;
}

function inRange(md, range) {
  if (!range) return true;
  const k = dateKey(md);
  return k >= dateKey(range.from) && k <= dateKey(range.to);
}

// ---------------------------------------------------------------------------
// Rule matcher: look for a validCodes key or label inside the task text
// ---------------------------------------------------------------------------

function ruleMatch(task, validCodes) {
  if (!task) return null;
  const lower = task.toLowerCase();

  // Collect (keyword, code, length) tuples so we can prefer longest match.
  const candidates = [];
  for (const [code, info] of Object.entries(validCodes)) {
    // Match the code key itself (e.g., "KEYPO")
    candidates.push({ keyword: code, code, length: code.length });
    // Also match the label if it's a sensible bare-token (skip pure-Chinese
    // labels like "會議" — those are handled by meeting auto-detect, and
    // matching "會議" as a label would short-circuit MEETING above meeting).
    if (info?.label && /[A-Za-z]/.test(info.label)) {
      // Use only the first token of the label (e.g., "KEYPO 平台" → "KEYPO")
      const firstWord = info.label.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 2) {
        candidates.push({ keyword: firstWord, code, length: firstWord.length });
      }
    }
  }

  // Sort by length DESC so "KEYDERS" beats "KEY" when both are present.
  candidates.sort((a, b) => b.length - a.length || a.code.localeCompare(b.code));

  for (const c of candidates) {
    const kw = c.keyword.toLowerCase();
    if (lower.includes(kw)) {
      return { code: c.code, keyword: c.keyword };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Meeting auto-detect
// ---------------------------------------------------------------------------

function meetingMatch(task, validCodes) {
  if (!task) return null;
  if (!validCodes.MEETING) return null;
  if (MEETING_KEYWORDS.test(task)) {
    const m = task.match(MEETING_KEYWORDS);
    return { code: 'MEETING', keyword: m[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Commit-enriched matcher
// ---------------------------------------------------------------------------

function commitMatch(commits, validCodes) {
  if (!Array.isArray(commits) || commits.length === 0) return null;

  const counts = {}; // code → { count, project }
  for (const commit of commits) {
    const project = (commit?.project || '').toLowerCase();
    if (!project) continue;
    for (const [code, info] of Object.entries(validCodes)) {
      const prefixes = info?.gitlabProjectPrefixes;
      if (!Array.isArray(prefixes)) continue;
      for (const prefix of prefixes) {
        if (project.includes(prefix.toLowerCase())) {
          if (!counts[code]) counts[code] = { count: 0, project: commit.project };
          counts[code].count++;
          break;
        }
      }
    }
  }

  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  // Most frequent wins; tiebreak alphabetically on code for determinism.
  entries.sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const [code, meta] = entries[0];
  return { code, project: meta.project };
}

// ---------------------------------------------------------------------------
// Per-item recommendation
// ---------------------------------------------------------------------------

function recommendForItem({ task, currentCode, commits, validCodes, includeAll = false }) {
  // Already coded → preserve unless caller asked to re-suggest.
  if (currentCode && !includeAll) {
    return {
      recommendedCode: currentCode,
      source: 'existing',
      confidence: 'high',
    };
  }

  // 1. Rule (task description)
  const rule = ruleMatch(task, validCodes);
  if (rule) {
    return {
      recommendedCode: rule.code,
      source: 'rule',
      matchedKeyword: rule.keyword,
      confidence: 'high',
    };
  }

  // 2. Meeting auto-detect
  const meeting = meetingMatch(task, validCodes);
  if (meeting) {
    return {
      recommendedCode: meeting.code,
      source: 'meeting',
      matchedKeyword: meeting.keyword,
      confidence: 'medium',
    };
  }

  // 3. Commit project match
  const ccm = commitMatch(commits, validCodes);
  if (ccm) {
    return {
      recommendedCode: ccm.code,
      source: 'commit',
      matchedProject: ccm.project,
      confidence: 'medium',
    };
  }

  // 4. None
  return {
    recommendedCode: null,
    source: 'none',
    confidence: 'low',
  };
}

// ---------------------------------------------------------------------------
// Batch orchestration
// ---------------------------------------------------------------------------

function recommendAll({
  data,
  commits,
  department = null,
  member = null,
  dateRange = null,
  includeAll = false,
  limit = null,
} = {}) {
  const range = parseDateRange(dateRange);
  const recs = [];
  let totalItemsScanned = 0;

  const rawData = data?.rawData || {};
  const centers = data?.centers || {};
  const commitsByDateMember = commits?.commits || {};

  // Deterministic ordering: sort dates ascending, members alphabetically.
  const dates = Object.keys(rawData).sort((a, b) => dateKey(a) - dateKey(b));

  for (const date of dates) {
    if (!inRange(date, range)) continue;
    const dayMembers = rawData[date];
    const memberKeys = Object.keys(dayMembers).sort();

    for (const m of memberKeys) {
      if (member && m !== member) continue;
      const dept = resolveMemberDepartment(m, centers);
      if (department && dept !== department) continue;

      const memberItems = dayMembers[m].items || [];
      const validCodes = resolveValidCodes(data, dept);
      const memberCommits = commitsByDateMember[date]?.[m]?.items || [];

      memberItems.forEach((item, itemIndex) => {
        totalItemsScanned++;
        const isNull = item.code === null || item.code === undefined;
        if (!isNull && !includeAll) return; // skip already-coded

        const result = recommendForItem({
          task: item.task,
          currentCode: item.code,
          commits: memberCommits,
          validCodes,
          includeAll,
        });

        // Skip "existing" entries from the output — they represent items
        // we deliberately did NOT re-suggest (default mode).
        if (result.source === 'existing') return;

        recs.push({
          date,
          department: dept,
          member: m,
          itemIndex,
          task: item.task,
          currentCode: item.code ?? null,
          ...result,
        });
      });
    }
  }

  const recommendations = limit != null ? recs.slice(0, limit) : recs;
  const summary = buildSummary(recommendations, totalItemsScanned);
  return { summary, recommendations };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(recs, totalItemsScanned) {
  const totalNullItems = recs.length;
  let recommended = 0;
  let noRecommendation = 0;
  const byCode = {};
  const byDepartment = {};
  const bySource = {};

  for (const r of recs) {
    if (r.recommendedCode) {
      recommended++;
      byCode[r.recommendedCode] = (byCode[r.recommendedCode] || 0) + 1;
    } else {
      noRecommendation++;
    }
    if (r.department) {
      byDepartment[r.department] = (byDepartment[r.department] || 0) + 1;
    }
    bySource[r.source] = (bySource[r.source] || 0) + 1;
  }

  const coverageRate = totalNullItems > 0 ? recommended / totalNullItems : 0;

  return {
    totalItemsScanned,
    totalNullItems,
    recommended,
    noRecommendation,
    coverageRate: Math.round(coverageRate * 1000) / 1000,
    byCode,
    byDepartment,
    bySource,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    date: null,
    department: null,
    member: null,
    includeAll: false,
    limit: null,
    raw: 'public/raw_data.json',
    commits: 'public/gitlab-commits.json',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--date':       args.date = next(); break;
      case '--department': args.department = next(); break;
      case '--member':     args.member = next(); break;
      case '--all':        args.includeAll = true; break;
      case '--null-only':  args.includeAll = false; break;
      case '--limit':      args.limit = parseInt(next(), 10); break;
      case '--raw':        args.raw = next(); break;
      case '--commits':    args.commits = next(); break;
      default:
        if (a.startsWith('--')) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = path.resolve(process.cwd(), args.raw);
  const commitsPath = path.resolve(process.cwd(), args.commits);

  const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const commits = fs.existsSync(commitsPath)
    ? JSON.parse(fs.readFileSync(commitsPath, 'utf8'))
    : { commits: {}, analysis: {}, projectRisks: [] };

  const out = recommendAll({
    data,
    commits,
    department: args.department,
    member: args.member,
    dateRange: args.date,
    includeAll: args.includeAll,
    limit: args.limit,
  });

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    process.stderr.write(`recommend-codes: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  recommendForItem,
  recommendAll,
  buildSummary,
  resolveMemberDepartment,
  resolveValidCodes,
  ruleMatch,
  meetingMatch,
  commitMatch,
  parseDateRange,
  inRange,
};
