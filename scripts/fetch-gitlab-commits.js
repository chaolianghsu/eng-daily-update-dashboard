#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

// --- Date Utilities ---

function parseDateArg(arg) {
  if (arg.includes('-') && arg.split('-').length === 2 && arg.split('-').every(p => /^\d{1,2}\/\d{1,2}$/.test(p))) {
    const [since, until] = arg.split('-');
    return { since, until };
  }
  return { since: arg, until: arg };
}

function dateToMD(isoString) {
  // Parse in +08:00 timezone to avoid local timezone issues
  const d = new Date(isoString);
  // Adjust to +08:00: add 8 hours offset then use UTC methods
  const utcMs = d.getTime() + (8 * 60 * 60 * 1000);
  const adjusted = new Date(utcMs);
  return `${adjusted.getUTCMonth() + 1}/${adjusted.getUTCDate()}`;
}

function mdToISO(md, isUntil = false) {
  const [month, day] = md.split('/').map(Number);
  const now = new Date();
  let year = now.getFullYear();
  // Year rollover: if month is in the future by >6 months, use previous year
  if (month > now.getMonth() + 7) year--;
  const d = new Date(year, month - 1, day + (isUntil ? 1 : 0));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00+08:00`;
}

function getPreviousWorkday(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// --- API Helpers ---

function fetchJSON(url, token) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'PRIVATE-TOKEN': token },
    };
    https.get(options, (res) => {
      if (res.statusCode === 401) return reject(new Error('GitLab token invalid or expired'));
      if (res.statusCode === 429) return reject(new Error('RATE_LIMITED'));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`GitLab API error: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          const nextPage = res.headers['x-next-page'];
          resolve({ body, nextPage: nextPage && nextPage !== '' ? nextPage : null });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllPages(url, token, maxRetries = 3) {
  const results = [];
  let currentUrl = url;
  while (currentUrl) {
    let attempt = 0;
    let resp;
    while (attempt < maxRetries) {
      try {
        resp = await fetchJSON(currentUrl, token);
        break;
      } catch (e) {
        if (e.message === 'RATE_LIMITED' && attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          attempt++;
        } else { throw e; }
      }
    }
    if (Array.isArray(resp.body)) results.push(...resp.body);
    if (resp.nextPage) {
      const u = new URL(currentUrl);
      u.searchParams.set('page', resp.nextPage);
      currentUrl = u.toString();
    } else {
      currentUrl = null;
    }
  }
  return results;
}

// --- Commit Filtering ---

function filterAndMapCommits(commits, projectPath, memberMap, excludeAuthors) {
  const results = [];
  for (const c of commits) {
    if (excludeAuthors.includes(c.author_name)) continue;
    const member = memberMap[c.author_name];
    results.push({
      member: member || c.author_name,
      date: dateToMD(c.committed_date),
      datetime: c.committed_date,
      project: projectPath,
      title: c.title,
      sha: c.short_id,
      url: c.web_url || null,
      unmapped: !member,
      source: 'gitlab',
    });
  }
  return results;
}

// --- Analysis ---

function buildAnalysis(commits, rawData, dailyUpdateMembers) {
  // Group commits by date → member (deduplicate by sha+project)
  const commitsByDateMember = {};
  const projectContributors = {};
  const seenCommits = new Set();

  for (const c of commits) {
    if (c.unmapped) continue;
    const dedupKey = `${c.date}|${c.member}|${c.sha}|${c.project}`;
    if (seenCommits.has(dedupKey)) continue;
    seenCommits.add(dedupKey);
    const key = `${c.date}|${c.member}`;
    if (!commitsByDateMember[key]) commitsByDateMember[key] = [];
    commitsByDateMember[key].push(c);

    // Track project contributors
    if (!projectContributors[c.project]) projectContributors[c.project] = new Set();
    projectContributors[c.project].add(c.member);
  }

  // Build analysis per date × member
  const analysis = {};
  const commitDates = [...new Set(commits.filter(c => !c.unmapped).map(c => c.date))];
  // Only analyze dates that have commits OR fall within the fetched date range
  // Determine fetched range from commit dates
  const fetchedDateNums = commitDates.map(d => { const p = d.split('/').map(Number); return p[0] * 100 + p[1]; });
  const minFetched = Math.min(...fetchedDateNums);
  const maxFetched = Math.max(...fetchedDateNums);
  const rawDataDatesInRange = Object.keys(rawData).filter(d => {
    const p = d.split('/').map(Number);
    const n = p[0] * 100 + p[1];
    return n >= minFetched && n <= maxFetched;
  });
  const allDates = [...new Set([...commitDates, ...rawDataDatesInRange])].sort((a, b) => {
    const [am, ad] = a.split('/').map(Number);
    const [bm, bd] = b.split('/').map(Number);
    return (am * 100 + ad) - (bm * 100 + bd);
  });

  for (const date of allDates) {
    analysis[date] = {};
    for (const member of dailyUpdateMembers) {
      const key = `${date}|${member}`;
      const memberCommits = commitsByDateMember[key] || [];
      const hourData = rawData[date]?.[member];
      const hasHours = hourData && hourData.total !== null;
      const hasCommits = memberCommits.length > 0;

      let status;
      if (hasHours && hasCommits) status = '✅';
      else if (hasHours && !hasCommits) status = '⚠️';
      else if (!hasHours && hasCommits) status = '🔴';
      else continue; // No data at all — skip

      analysis[date][member] = {
        status,
        commitCount: memberCommits.length,
        hours: hourData?.total ?? null,
      };
    }
  }

  // Identify single-contributor projects
  const projectRisks = [];
  for (const [project, contributors] of Object.entries(projectContributors)) {
    if (contributors.size === 1) {
      const solo = [...contributors][0];
      projectRisks.push({ project, soloContributor: solo, severity: '🟡' });
    }
  }

  return { analysis, projectRisks };
}

// --- Output ---

function buildDashboardJSON(commits, analysis, projectRisks) {
  // Group commits by date → member for dashboard format (deduplicate by sha+project)
  const commitsByDate = {};
  const seen = new Set();
  for (const c of commits) {
    if (c.unmapped) continue;
    const dedupKey = `${c.date}|${c.member}|${c.sha}|${c.project}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    if (!commitsByDate[c.date]) commitsByDate[c.date] = {};
    if (!commitsByDate[c.date][c.member]) {
      commitsByDate[c.date][c.member] = { count: 0, projects: [], items: [] };
    }
    const m = commitsByDate[c.date][c.member];
    m.count++;
    if (!m.projects.includes(c.project)) m.projects.push(c.project);
    m.items.push({ title: c.title, sha: c.sha, project: c.project, url: c.url, datetime: c.datetime, source: c.source });
  }
  return { commits: commitsByDate, analysis, projectRisks };
}

function buildPostPayload(commits, analysisResult) {
  // Flat arrays for Apps Script (deduplicate by date|member|sha|project)
  const seenPost = new Set();
  const gitlabCommits = [];
  for (const c of commits) {
    if (c.unmapped) continue;
    const key = `${c.date}|${c.member}|${c.sha}|${c.project}`;
    if (seenPost.has(key)) continue;
    seenPost.add(key);
    gitlabCommits.push({ date: c.date, member: c.member, project: c.project, title: c.title, sha: c.sha, url: c.url, source: c.source });
  }

  const commitAnalysis = [];
  for (const [date, members] of Object.entries(analysisResult.analysis)) {
    for (const [member, data] of Object.entries(members)) {
      const memberCommits = commits.filter(c => c.date === date && c.member === member);
      const projects = [...new Set(memberCommits.map(c => c.project))].join(', ');
      commitAnalysis.push({
        date, member,
        commitCount: data.commitCount,
        dailyUpdateHours: data.hours,
        status: data.status,
        projects,
      });
    }
  }

  return { gitlabCommits, commitAnalysis };
}

// --- Collect commits (shared by main and collect-gitlab-commits.js) ---

async function collectCommits(dateArg) {
  const configPath = path.join(ROOT, 'gitlab-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('gitlab-config.json not found');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { baseUrl, token, memberMap, excludeAuthors = [] } = config;

  const dateRange = dateArg ? parseDateArg(dateArg) : { since: getPreviousWorkday(), until: getPreviousWorkday() };
  const sinceISO = mdToISO(dateRange.since);
  const untilISO = mdToISO(dateRange.until, true);

  console.error(`Fetching commits for ${dateRange.since}${dateRange.since !== dateRange.until ? '-' + dateRange.until : ''}...`);

  const sinceDate = new Date(sinceISO);
  sinceDate.setDate(sinceDate.getDate() - 1);
  const lastActivityAfter = sinceDate.toISOString().split('T')[0];
  const projectsUrl = `${baseUrl}/api/v4/projects?per_page=100&order_by=last_activity_at&last_activity_after=${lastActivityAfter}`;
  const projects = await fetchAllPages(projectsUrl, token);
  console.error(`Found ${projects.length} projects with activity after ${lastActivityAfter}`);

  const allCommits = [];
  const warnings = [];
  for (const proj of projects) {
    const commitsUrl = `${baseUrl}/api/v4/projects/${proj.id}/repository/commits?since=${encodeURIComponent(sinceISO)}&until=${encodeURIComponent(untilISO)}&all=true&per_page=100`;
    try {
      const rawCommits = await fetchAllPages(commitsUrl, token);
      if (rawCommits.length === 0) continue;
      const mapped = filterAndMapCommits(rawCommits, proj.path_with_namespace, memberMap, excludeAuthors);
      for (const c of mapped) {
        if (c.unmapped && !warnings.includes(c.member)) warnings.push(c.member);
      }
      allCommits.push(...mapped.filter(c => !c.unmapped));
      console.error(`  ${proj.path_with_namespace}: ${rawCommits.length} commits (${mapped.filter(c => !c.unmapped).length} mapped)`);
    } catch (e) {
      if (e.message.includes('token')) throw e;
      continue;
    }
  }

  if (warnings.length > 0) {
    console.error(`\nWarning: unmapped authors: ${warnings.join(', ')}`);
  }

  return { config, dateRange, allCommits };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  let dateArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) { dateArg = args[i + 1]; i++; }
  }

  const { config, dateRange, allCommits } = await collectCommits(dateArg);

  // Load raw_data.json for analysis
  const rawDataPath = path.join(ROOT, 'public', 'raw_data.json');
  const existing = fs.existsSync(rawDataPath)
    ? JSON.parse(fs.readFileSync(rawDataPath, 'utf8'))
    : { rawData: {} };
  const dailyUpdateMembers = Object.keys(
    existing.rawData[Object.keys(existing.rawData).pop()] || {}
  );

  // Build analysis
  const analysisResult = buildAnalysis(allCommits, existing.rawData, dailyUpdateMembers);

  // Write gitlab-commits.json for dashboard (merge with existing data)
  const dashboardData = buildDashboardJSON(allCommits, analysisResult.analysis, analysisResult.projectRisks);
  const gitlabJsonPath = path.join(ROOT, 'public', 'gitlab-commits.json');
  if (fs.existsSync(gitlabJsonPath)) {
    const existingGitlab = JSON.parse(fs.readFileSync(gitlabJsonPath, 'utf8'));
    // Merge: new dates overwrite, old dates preserved
    for (const [date, data] of Object.entries(dashboardData.commits)) { existingGitlab.commits[date] = data; }
    for (const [date, data] of Object.entries(dashboardData.analysis)) { existingGitlab.analysis[date] = data; }
    existingGitlab.projectRisks = dashboardData.projectRisks;
    fs.writeFileSync(gitlabJsonPath, JSON.stringify(existingGitlab, null, 2));
  } else {
    fs.writeFileSync(gitlabJsonPath, JSON.stringify(dashboardData, null, 2));
  }
  console.error(`\nWrote gitlab-commits.json (merged)`);

  // Output POST payload to stdout
  const postPayload = buildPostPayload(allCommits, analysisResult);

  // Also output summary to stderr
  const summary = {};
  for (const c of allCommits) {
    if (!summary[c.member]) summary[c.member] = { totalCommits: 0, projects: new Set(), activeDays: new Set() };
    summary[c.member].totalCommits++;
    summary[c.member].projects.add(c.project);
    summary[c.member].activeDays.add(c.date);
  }
  const summaryObj = {};
  for (const [m, s] of Object.entries(summary)) {
    summaryObj[m] = { totalCommits: s.totalCommits, projects: [...s.projects], activeDays: s.activeDays.size };
  }

  const output = {
    fetchDate: new Date().toISOString().split('T')[0],
    dateRange,
    ...postPayload,
    summary: summaryObj,
  };

  console.log(JSON.stringify(output, null, 2));
  console.error(`\nDone: ${allCommits.length} commits from ${Object.keys(summary).length} members`);
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}

module.exports = {
  parseDateArg, dateToMD, mdToISO, getPreviousWorkday,
  filterAndMapCommits, fetchAllPages, buildAnalysis,
  buildDashboardJSON, buildPostPayload, collectCommits,
};
