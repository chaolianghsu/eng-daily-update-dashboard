#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

const {
  parseDateArg, dateToMD, mdToISO, getPreviousWorkday,
  buildAnalysis, buildDashboardJSON, buildPostPayload,
} = require('./fetch-gitlab-commits');

const { dedupCommitItems } = require('./analyze-consistency');

// --- GitHub API Helpers ---

function parseLinkHeader(header) {
  if (!header) return null;
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function fetchGitHubJSON(url, token) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'eng-daily-update-dashboard',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    https.get(options, (res) => {
      if (res.statusCode === 401) return reject(new Error('GitHub token invalid or expired'));
      if (res.statusCode === 403) {
        const remaining = res.headers['x-ratelimit-remaining'];
        if (remaining === '0') return reject(new Error('RATE_LIMITED'));
        return reject(new Error(`GitHub API forbidden: ${res.statusCode}`));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`GitHub API error: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          const nextUrl = parseLinkHeader(res.headers['link'] || '');
          resolve({ body, nextUrl });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllGitHubPages(url, token, maxRetries = 3) {
  const results = [];
  let currentUrl = url;
  while (currentUrl) {
    let attempt = 0;
    let resp;
    while (attempt < maxRetries) {
      try {
        resp = await fetchGitHubJSON(currentUrl, token);
        break;
      } catch (e) {
        if (e.message === 'RATE_LIMITED' && attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          attempt++;
        } else { throw e; }
      }
    }
    // Check rate limit
    if (Array.isArray(resp.body)) {
      results.push(...resp.body);
    }
    currentUrl = resp.nextUrl || null;
  }
  return results;
}

// --- Commit Filtering ---

function filterAndMapGitHubCommits(commits, repoName, memberMap, excludeAuthors) {
  const results = [];
  for (const c of commits) {
    const authorLogin = c.author?.login;
    const authorName = authorLogin || c.commit.committer.name;
    if (excludeAuthors.includes(authorName)) continue;
    const member = memberMap[authorName];
    results.push({
      member: member || authorName,
      date: dateToMD(c.commit.committer.date),
      datetime: c.commit.committer.date,
      project: repoName,
      title: c.commit.message.split('\n')[0],
      sha: c.sha.slice(0, 8),
      url: c.html_url || null,
      unmapped: !member,
      source: 'github',
    });
  }
  return results;
}

// --- Collect commits ---

async function collectGitHubCommits(dateArg) {
  const configPath = path.join(ROOT, 'github-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('github-config.json not found');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { baseUrl, org, token, memberMap, excludeAuthors = [] } = config;

  const dateRange = dateArg ? parseDateArg(dateArg) : { since: getPreviousWorkday(), until: getPreviousWorkday() };
  const sinceISO = mdToISO(dateRange.since);
  const untilISO = mdToISO(dateRange.until, true);

  console.error(`Fetching GitHub commits for ${dateRange.since}${dateRange.since !== dateRange.until ? '-' + dateRange.until : ''}...`);

  // Fetch org repos
  const reposUrl = `${baseUrl}/orgs/${org}/repos?per_page=100&sort=pushed&direction=desc`;
  const repos = await fetchAllGitHubPages(reposUrl, token);
  console.error(`Found ${repos.length} repos in org ${org}`);

  // Filter repos by push date (similar to GitLab's last_activity_after)
  const sinceDate = new Date(sinceISO);
  sinceDate.setDate(sinceDate.getDate() - 1);
  const activeRepos = repos.filter(r => {
    if (!r.pushed_at) return false;
    return new Date(r.pushed_at) >= sinceDate;
  });
  console.error(`${activeRepos.length} repos with recent activity`);

  const allCommits = [];
  const warnings = [];
  for (const repo of activeRepos) {
    const commitsUrl = `${baseUrl}/repos/${org}/${repo.name}/commits?per_page=100&since=${encodeURIComponent(sinceISO)}&until=${encodeURIComponent(untilISO)}`;
    try {
      const rawCommits = await fetchAllGitHubPages(commitsUrl, token);
      if (rawCommits.length === 0) continue;
      const mapped = filterAndMapGitHubCommits(rawCommits, `${org}/${repo.name}`, memberMap, excludeAuthors);
      for (const c of mapped) {
        if (c.unmapped && !warnings.includes(c.member)) warnings.push(c.member);
      }
      allCommits.push(...mapped.filter(c => !c.unmapped));
      console.error(`  ${org}/${repo.name}: ${rawCommits.length} commits (${mapped.filter(c => !c.unmapped).length} mapped)`);
    } catch (e) {
      if (e.message.includes('token') || e.message === 'RATE_LIMITED') throw e;
      console.error(`  ${org}/${repo.name}: skipped (${e.message})`);
      continue;
    }
  }

  if (warnings.length > 0) {
    console.error(`\nWarning: unmapped GitHub authors: ${warnings.join(', ')}`);
  }

  return { config, dateRange, allCommits };
}

// --- Main (standalone mode) ---

async function main() {
  const args = process.argv.slice(2);
  let dateArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) { dateArg = args[i + 1]; i++; }
  }

  const { config, dateRange, allCommits } = await collectGitHubCommits(dateArg);

  // Load raw_data.json for analysis
  const rawDataPath = path.join(ROOT, 'public', 'raw_data.json');
  const existing = fs.existsSync(rawDataPath)
    ? JSON.parse(fs.readFileSync(rawDataPath, 'utf8'))
    : { rawData: {} };
  const dailyUpdateMembers = Object.keys(
    existing.rawData[Object.keys(existing.rawData).pop()] || {}
  );

  // Load existing gitlab-commits.json — single pass builds SHA set + flat array
  const gitlabJsonPath = path.join(ROOT, 'public', 'gitlab-commits.json');
  const existingSHAs = new Set();
  const existingFlat = [];
  if (fs.existsSync(gitlabJsonPath)) {
    const existingGitlab = JSON.parse(fs.readFileSync(gitlabJsonPath, 'utf8'));
    for (const [date, members] of Object.entries(existingGitlab.commits)) {
      for (const [member, info] of Object.entries(members)) {
        for (const item of info.items) {
          existingSHAs.add(`${item.sha}|${item.project}`);
          existingFlat.push({
            member, date, datetime: item.datetime,
            project: item.project, title: item.title,
            sha: item.sha, url: item.url,
            unmapped: false, source: item.source || 'gitlab',
          });
        }
      }
    }
  }

  // Dedup GitHub commits against existing sha|project keys
  const newCommits = allCommits.filter(c => !existingSHAs.has(`${c.sha}|${c.project}`));
  console.error(`\nGitHub commits: ${allCommits.length} total, ${newCommits.length} new (${allCommits.length - newCommits.length} already in gitlab-commits.json)`);

  const mergedCommits = [...existingFlat, ...newCommits];

  // Build analysis on merged data
  const analysisResult = buildAnalysis(mergedCommits, existing.rawData, dailyUpdateMembers);

  // Write merged gitlab-commits.json
  const dashboardData = buildDashboardJSON(mergedCommits, analysisResult.analysis, analysisResult.projectRisks);
  dedupCommitItems(dashboardData);
  fs.writeFileSync(gitlabJsonPath, JSON.stringify(dashboardData, null, 2));
  console.error(`Wrote gitlab-commits.json (merged with GitHub commits)`);

  // Output POST payload to stdout
  const postPayload = buildPostPayload(mergedCommits, analysisResult);

  // Summary to stderr
  const summary = {};
  for (const c of newCommits) {
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
  console.error(`\nDone: ${newCommits.length} new GitHub commits from ${Object.keys(summary).length} members`);
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}

module.exports = {
  collectGitHubCommits,
  parseLinkHeader,
  filterAndMapGitHubCommits,
};
