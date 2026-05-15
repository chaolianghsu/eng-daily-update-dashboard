#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_URL = 'https://chaolianghsu.github.io/eng-daily-update-dashboard/';

// --- Date Utilities ---

function dateToNum(d) {
  const p = d.split('/').map(Number);
  return p[0] * 100 + p[1];
}

function isDateInRange(date, start, end) {
  return dateToNum(date) >= dateToNum(start) && dateToNum(date) <= dateToNum(end);
}

function isOnLeave(date, ranges) {
  return (ranges || []).some(r => isDateInRange(date, r.start, r.end));
}

function pad(n) { return n; }

function formatMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Parse a week argument in M/D-M/D form.
 * Returns { start, end } or null if invalid.
 */
function parseWeekArg(arg) {
  if (!arg || typeof arg !== 'string') return null;
  if (!arg.includes('-')) return null;
  const parts = arg.split('-');
  if (parts.length !== 2) return null;
  if (!parts.every(p => /^\d{1,2}\/\d{1,2}$/.test(p))) return null;
  return { start: parts[0], end: parts[1] };
}

/**
 * Compute the last full Mon-Fri week relative to `today`.
 * - If today is Mon: returns prior week (Mon-Fri).
 * - If today is Tue-Sun: returns prior week's Mon-Fri.
 *   i.e. always the most recently completed Mon-Fri block.
 */
function computeDefaultWeek(today) {
  const t = new Date(today);
  t.setHours(12, 0, 0, 0);
  const dow = t.getDay(); // 0 Sun, 1 Mon, ... 6 Sat
  // Days to subtract from `t` to land on the previous full week's Friday.
  // If today is Sun (0): last Fri was 2 days ago.
  // If today is Mon (1): last Fri was 3 days ago.
  // Tue (2): 4, Wed (3): 5, Thu (4): 6, Fri (5): 7, Sat (6): 8.
  const map = { 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8 };
  const friOffset = map[dow];
  const friday = new Date(t);
  friday.setDate(t.getDate() - friOffset);
  const monday = new Date(friday);
  monday.setDate(friday.getDate() - 4);
  return { start: formatMD(monday), end: formatMD(friday) };
}

/**
 * Expand a start/end M/D range to inclusive list of M/D strings.
 * Year is implicit (current year) since the dashboard data uses M/D keys.
 */
function expandWeekDates(start, end) {
  const [sm, sd] = start.split('/').map(Number);
  const [em, ed] = end.split('/').map(Number);
  // Use a base year (any leap-safe year is fine for short ranges).
  const year = new Date().getFullYear();
  const cur = new Date(year, sm - 1, sd);
  const last = new Date(year, em - 1, ed);
  // Handle wrap (e.g. 12/29-1/2): if end < start, push end year by 1.
  if (last < cur) last.setFullYear(year + 1);
  const out = [];
  while (cur <= last) {
    out.push(`${cur.getMonth() + 1}/${cur.getDate()}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// --- Aggregation ---

/**
 * Normalize centers config. If missing/null, fall back to a single 工程 center
 * containing all members observed in rawData.
 */
function normalizeCenters(centersConfig, rawData) {
  if (centersConfig && typeof centersConfig === 'object' && Object.keys(centersConfig).length > 0) {
    return centersConfig;
  }
  const members = new Set();
  for (const date of Object.keys(rawData || {})) {
    for (const m of Object.keys(rawData[date] || {})) {
      members.add(m);
    }
  }
  return {
    工程: { label: '工程部', members: Array.from(members) },
  };
}

const SEVERITY_RANK = { '🔴': 0, '🟠': 1, '🟡': 2, '🟢': 3 };
function severityRank(s) {
  return SEVERITY_RANK[s] != null ? SEVERITY_RANK[s] : 9;
}

/**
 * Aggregate per-center metrics for a week.
 *
 * Inputs:
 * - rawData: { 'M/D': { member: { total, meeting, dev } } }
 * - centers: { key: { label, members: [...] } } | null
 * - leave: { member: [{start,end}] } | null
 * - commits: { 'M/D': { member: { count, projects, items } } } | null
 * - analysis: { 'M/D': { member: { status, commitCount, hours } } } | null
 * - taskAnalysis: { warnings: [...] } | null
 * - planAnalysis: { summary: { matched, unmatched, partial, totalSpecCommits } } | null
 * - weekDates: ['M/D', ...]
 *
 * Returns { centers: [...], specActivity: {...}, weekDates }.
 */
function aggregateMetrics({
  rawData,
  centers,
  leave,
  commits,
  analysis,
  taskAnalysis,
  planAnalysis,
  weekDates,
}) {
  const normCenters = normalizeCenters(centers, rawData);
  const safeCommits = commits || {};
  const safeAnalysis = analysis || {};
  const safeLeave = leave || {};
  const safeTask = taskAnalysis || { warnings: [] };

  const memberToCenter = {};
  for (const [key, cfg] of Object.entries(normCenters)) {
    for (const m of cfg.members || []) {
      memberToCenter[m] = key;
    }
  }

  const out = [];
  for (const [key, cfg] of Object.entries(normCenters)) {
    const members = cfg.members || [];
    const memberCount = members.length;
    const workdays = weekDates.length;
    let reportedEntries = 0;
    let totalDevHours = 0;
    let totalMeetingHours = 0;
    let totalCommits = 0;
    const consistency = { '✅': 0, '⚠️': 0, '🔴': 0 };
    let totalEntries = 0;

    for (const date of weekDates) {
      const dayData = rawData[date] || {};
      const dayCommits = safeCommits[date] || {};
      const dayAnalysis = safeAnalysis[date] || {};

      for (const m of members) {
        // Members on leave for this date don't count toward total entries.
        if (isOnLeave(date, safeLeave[m])) continue;
        totalEntries += 1;
        const entry = dayData[m];
        if (entry && entry.total != null) {
          reportedEntries += 1;
          if (typeof entry.dev === 'number') totalDevHours += entry.dev;
          if (typeof entry.meeting === 'number') totalMeetingHours += entry.meeting;
        }
        if (dayCommits[m] && typeof dayCommits[m].count === 'number') {
          totalCommits += dayCommits[m].count;
        }
        const a = dayAnalysis[m];
        if (a && a.status && consistency[a.status] != null) {
          consistency[a.status] += 1;
        }
      }
    }

    // Top warnings: filter task warnings to this center's members + within week.
    const memberSet = new Set(members);
    const warnings = (safeTask.warnings || [])
      .filter(w => memberSet.has(w.member) && weekDates.includes(w.date))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .slice(0, 5);

    // Consecutive missing (≥3) for this center's members.
    const consecutiveMissing = findConsecutiveMissing(rawData, members, weekDates, safeLeave);

    out.push({
      key,
      label: cfg.label || key,
      memberCount,
      workdays,
      reportedEntries,
      totalEntries,
      reportingRate: totalEntries > 0 ? reportedEntries / totalEntries : 0,
      totalDevHours,
      totalMeetingHours,
      avgDevHoursPerMember: memberCount > 0 ? totalDevHours / memberCount : 0,
      totalCommits,
      consistency,
      topWarnings: warnings,
      consecutiveMissing,
    });
  }

  // Spec activity is global (plan-analysis.json is not per-center)
  const planSum = (planAnalysis && planAnalysis.summary) || {};
  const specActivity = {
    matched: planSum.matched || 0,
    unmatched: planSum.unmatched || 0,
    partial: planSum.partial || 0,
    totalSpecCommits: planSum.totalSpecCommits || 0,
  };

  return { centers: out, specActivity, weekDates };
}

/**
 * Find members with ≥3 consecutive missing days (total === null/undefined and not on leave).
 * Returns [{ member, missingDays }].
 */
function findConsecutiveMissing(rawData, members, weekDates, leave) {
  const safeLeave = leave || {};
  const result = [];
  for (const m of members) {
    let maxStreak = 0;
    let cur = 0;
    for (const d of weekDates) {
      const entry = (rawData[d] || {})[m];
      const onLeave = isOnLeave(d, safeLeave[m]);
      if (onLeave) {
        cur = 0; // leave days don't count as missing
        continue;
      }
      const missing = !entry || entry.total == null;
      if (missing) {
        cur += 1;
        if (cur > maxStreak) maxStreak = cur;
      } else {
        cur = 0;
      }
    }
    if (maxStreak >= 3) {
      result.push({ member: m, missingDays: maxStreak });
    }
  }
  return result;
}

// --- Prompt Builder ---

function buildPrompt(metrics) {
  const { centers, specActivity } = metrics;
  const weekRange = metrics.weekRange || (metrics.weekDates && metrics.weekDates.length
    ? `${metrics.weekDates[0]}-${metrics.weekDates[metrics.weekDates.length - 1]}`
    : '');

  const centerBlocks = centers.map(c => {
    const cm = c.consecutiveMissing || [];
    const warnings = (c.topWarnings || []).map(w =>
      `- ${w.severity} ${w.member} ${w.date} | ${w.task || ''} | ${w.reasoning || ''}`
    ).join('\n') || '(無)';
    const missing = cm.length > 0
      ? cm.map(x => `${x.member} (${x.missingDays} 天)`).join(', ')
      : '(無)';
    return `### ${c.label} (${c.key})
- 成員數: ${c.memberCount}
- 工作天: ${c.workdays}
- 回報率: ${c.reportedEntries}/${c.totalEntries} (${(c.reportingRate * 100).toFixed(0)}%)
- 開發工時總和: ${c.totalDevHours.toFixed(1)}H (人均 ${c.avgDevHoursPerMember.toFixed(1)}H)
- 會議工時總和: ${c.totalMeetingHours.toFixed(1)}H
- Commits 總數: ${c.totalCommits}
- 一致性分布: ✅ ${c.consistency['✅']} / ⚠️ ${c.consistency['⚠️']} / 🔴 ${c.consistency['🔴']}
- 連續未回報 ≥3 天: ${missing}

**Top warnings (task analysis):**
${warnings}`;
  }).join('\n\n---\n\n');

  return `你是工程部高階主管的策略分析助理。請根據以下本週資料，產出一份給 CXO/部門主管看的 decision-grade 週報摘要。

## 週期: ${weekRange}

## 各中心資料

${centerBlocks}

## 全公司規劃文件追蹤
- 總 spec commits: ${specActivity.totalSpecCommits}
- ✅ matched: ${specActivity.matched}
- 🔴 unmatched: ${specActivity.unmatched}
- 🟡 partial: ${specActivity.partial}

## 輸出要求

請直接輸出有效的 JSON（不要加 markdown code fence、不要前後文字），格式如下：

{
  "weekRange": "${weekRange}",
  "highlights": [
    "本週重點 1（1 句，聚焦在「完成了什麼有商業價值的事」）",
    "本週重點 2",
    "本週重點 3"
  ],
  "attention": [
    {
      "severity": "🔴 或 🟡",
      "subject": "誰 / 哪個專案 / 哪個中心",
      "detail": "為什麼需要關注，1 句話"
    }
  ],
  "recommendations": [
    "下週建議 1（具體可執行）",
    "下週建議 2"
  ]
}

注意事項：
- highlights 必須恰好 3 條，每條 1 句話、聚焦商業價值或重大里程碑（不要列「完成了 X 個 commits」這種低訊息密度的內容）
- attention 最多 3 條，優先列 🔴，按嚴重度排序
- recommendations 1-3 條，必須具體可執行（例如「下週由 Alice 主導 X 模組整合」而非「加強溝通」）
- 所有文字用繁體中文
- 只輸出 JSON
`;
}

// --- Markdown Formatter ---

function formatChatMessage(digest) {
  const lines = [];
  lines.push(`📊 產品中心週報 (${digest.weekRange || ''})`);
  lines.push('');
  lines.push('🎯 本週重點');
  const highlights = digest.highlights || [];
  if (highlights.length === 0) {
    lines.push('(無)');
  } else {
    highlights.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  }
  lines.push('');
  lines.push('⚠️ 需關注 (top 3)');
  const attention = (digest.attention || []).slice(0, 3);
  if (attention.length === 0) {
    lines.push('• (無)');
  } else {
    attention.forEach(a => {
      const sev = a.severity || '';
      const subj = a.subject || '';
      const detail = a.detail || '';
      lines.push(`• ${sev} ${subj}${detail ? '：' + detail : ''}`);
    });
  }
  lines.push('');
  lines.push('💡 下週建議');
  const recs = digest.recommendations || [];
  if (recs.length === 0) {
    lines.push('• (無)');
  } else {
    recs.forEach(r => lines.push(`• ${r}`));
  }
  lines.push('');
  lines.push(`📈 Dashboard: ${DASHBOARD_URL}`);
  return lines.join('\n');
}

// --- AI Call (CLI fallback friendly) ---

function callClaude(prompt) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('claude', ['--print', '--model', 'sonnet'], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function tryParseJSON(text) {
  if (!text) return null;
  // Strip markdown fences if present.
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    // Try to find first {...} block
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

// --- Main ---

function readJSONIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    process.stderr.write(`Warning: failed to parse ${p}: ${e.message}\n`);
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  let weekArg = null;
  let outFormat = 'chat'; // chat | json
  let skipAI = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week' && args[i + 1]) {
      weekArg = args[i + 1];
      i += 1;
    } else if (args[i] === '--format' && args[i + 1]) {
      outFormat = args[i + 1];
      i += 1;
    } else if (args[i] === '--no-ai') {
      skipAI = true;
    }
  }

  let week;
  if (weekArg) {
    const parsed = parseWeekArg(weekArg);
    if (!parsed) {
      process.stderr.write(`Error: invalid --week "${weekArg}" (expected M/D-M/D)\n`);
      process.exit(1);
    }
    week = parsed;
  } else {
    week = computeDefaultWeek(new Date());
  }
  const weekDates = expandWeekDates(week.start, week.end);
  const weekRange = `${week.start}-${week.end}`;

  // Load data files (raw_data.json is required; the others gracefully default).
  const rawDataPath = path.join(ROOT, 'public', 'raw_data.json');
  if (!fs.existsSync(rawDataPath)) {
    process.stderr.write('Error: public/raw_data.json not found\n');
    process.exit(1);
  }
  const rawDataFile = readJSONIfExists(rawDataPath);
  if (!rawDataFile || !rawDataFile.rawData) {
    process.stderr.write('Error: public/raw_data.json missing rawData\n');
    process.exit(1);
  }

  const commitsFile = readJSONIfExists(path.join(ROOT, 'public', 'gitlab-commits.json')) || {};
  const taskAnalysis = readJSONIfExists(path.join(ROOT, 'public', 'task-analysis.json')) || { warnings: [] };
  const planAnalysis = readJSONIfExists(path.join(ROOT, 'public', 'plan-analysis.json')) || { summary: {} };

  const metrics = aggregateMetrics({
    rawData: rawDataFile.rawData,
    centers: rawDataFile.centers,
    leave: rawDataFile.leave,
    commits: commitsFile.commits || {},
    analysis: commitsFile.analysis || {},
    taskAnalysis,
    planAnalysis,
    weekDates,
  });
  metrics.weekRange = weekRange;

  const prompt = buildPrompt(metrics);

  let digest = null;
  if (!skipAI) {
    try {
      const out = callClaude(prompt);
      digest = tryParseJSON(out);
      if (!digest) {
        process.stderr.write('Warning: claude output was not valid JSON\n');
      }
    } catch (e) {
      process.stderr.write(`Warning: claude CLI call failed: ${e.message}\n`);
    }
  }

  if (!digest) {
    // Fallback: build a minimal digest from raw metrics so the script still
    // produces something useful (the skill prints this as the AI-failure fallback).
    const fallbackAttention = [];
    for (const c of metrics.centers) {
      for (const cm of c.consecutiveMissing) {
        fallbackAttention.push({
          severity: '🔴',
          subject: `${cm.member} (${c.label})`,
          detail: `連續 ${cm.missingDays} 天未回報`,
        });
      }
      for (const w of c.topWarnings.slice(0, 2)) {
        fallbackAttention.push({
          severity: w.severity || '🟡',
          subject: `${w.member} ${w.date}`,
          detail: w.reasoning || w.task || '',
        });
      }
    }
    digest = {
      weekRange,
      highlights: [
        `本週 ${metrics.centers.reduce((a, c) => a + c.totalCommits, 0)} 個 commits，` +
        `${metrics.centers.reduce((a, c) => a + c.totalDevHours, 0).toFixed(0)}H 開發工時`,
        `回報率 ${metrics.centers.map(c => `${c.label} ${Math.round(c.reportingRate * 100)}%`).join('、')}`,
        `Spec 追蹤：matched ${metrics.specActivity.matched}、unmatched ${metrics.specActivity.unmatched}`,
      ],
      attention: fallbackAttention.slice(0, 3),
      recommendations: ['AI 摘要未產生，請手動 review 上述指標'],
    };
  }

  if (outFormat === 'json') {
    process.stdout.write(JSON.stringify(digest, null, 2) + '\n');
  } else {
    process.stdout.write(formatChatMessage(digest) + '\n');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseWeekArg,
  computeDefaultWeek,
  expandWeekDates,
  aggregateMetrics,
  findConsecutiveMissing,
  buildPrompt,
  formatChatMessage,
  normalizeCenters,
  tryParseJSON,
};
