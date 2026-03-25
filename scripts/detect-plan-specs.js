#!/usr/bin/env node
'use strict';

/**
 * detect-plan-specs.js
 * Detects plan/spec/design commits via keyword matching and file path filtering.
 *
 * CLI: node scripts/detect-plan-specs.js --date 3/24
 * Outputs JSON array of candidates with doc files to stdout.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

const SPEC_KEYWORDS_EN = /\b(plan|spec|design|docs?|rfc|proposal|architecture)\b/i;
const SPEC_KEYWORDS_ZH = /規劃|設計|架構|文件/;
const FALSE_POSITIVES = /\b(docker|dockerfile|archive|archived)\b/i;

/**
 * Check if a commit title matches plan/spec keywords.
 * Returns true if it matches spec keywords AND does not match false positive exclusions.
 * @param {string} title - Commit title
 * @returns {boolean}
 */
function matchesSpecKeyword(title) {
  if (FALSE_POSITIVES.test(title)) return false;
  return SPEC_KEYWORDS_EN.test(title) || SPEC_KEYWORDS_ZH.test(title);
}

const DOC_DIR_PATTERN = /(?:^|\/)(docs|specs|plans|design)\/.+\.md$/;
const ROOT_SPEC_PATTERN = /^(SPEC|PLAN|DESIGN|RFC-[^/]+)\.md$/;

/**
 * Check if a file path is a doc/spec file.
 * Matches: paths with docs/, specs/, plans/, design/ directories with .md extension,
 * or root-level SPEC.md, PLAN.md, DESIGN.md, RFC-*.md files.
 * Rejects: non-.md files, README.md, CHANGELOG.md.
 * @param {string} filePath - File path relative to repo root
 * @returns {boolean}
 */
function isDocFile(filePath) {
  if (ROOT_SPEC_PATTERN.test(filePath)) return true;
  return DOC_DIR_PATTERN.test(filePath);
}

/**
 * Filter commits for a given date, returning candidates that match spec keywords.
 * @param {Object|null} dateCommits - commits[date] object: { member: { count, projects, items } }
 * @returns {Array<{member: string, commit: Object, files: Array}>}
 */
function filterSpecCommits(dateCommits) {
  if (!dateCommits) return [];
  const candidates = [];
  for (const [member, data] of Object.entries(dateCommits)) {
    if (!data || !data.items) continue;
    for (const item of data.items) {
      if (matchesSpecKeyword(item.title)) {
        candidates.push({ member, commit: item, files: [] });
      }
    }
  }
  return candidates;
}

// --- API Helpers ---

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
    };
    https.get(options, (res) => {
      if (res.statusCode === 429) return reject(new Error('RATE_LIMITED'));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`API error: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchWithRetry(url, headers, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchJSON(url, headers);
    } catch (e) {
      if (e.message === 'RATE_LIMITED' && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      } else {
        throw e;
      }
    }
  }
}

/**
 * Fetch file paths changed in a GitLab commit.
 * @param {string} projectPath - e.g. "bigdata/api"
 * @param {string} sha - Commit SHA
 * @param {{baseUrl: string, token: string}} config
 * @returns {Promise<string[]>} Array of file paths (new_path from each diff entry)
 */
async function fetchGitLabDiff(projectPath, sha, config) {
  const encoded = encodeURIComponent(projectPath);
  const url = `${config.baseUrl}/api/v4/projects/${encoded}/repository/commits/${sha}/diff`;
  const headers = { 'PRIVATE-TOKEN': config.token };
  const diff = await fetchWithRetry(url, headers);
  return Array.isArray(diff) ? diff.map(d => d.new_path) : [];
}

/**
 * Fetch file paths changed in a GitHub commit.
 * Extracts full SHA from commitUrl since dashboard stores 8-char truncated SHAs.
 * @param {string} project - e.g. "bigdata-54837596/repo-name"
 * @param {string} sha - Short commit SHA (may be 8 chars)
 * @param {string} commitUrl - Full commit URL containing the full SHA
 * @param {{token: string}} config
 * @returns {Promise<string[]>} Array of file paths (filename from files array)
 */
async function fetchGitHubFiles(project, sha, commitUrl, config) {
  const fullSha = commitUrl ? commitUrl.split('/commit/').pop() : sha;
  const url = `https://api.github.com/repos/${project}/commits/${fullSha}`;
  const headers = {
    'Authorization': `Bearer ${config.token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'eng-daily-update-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const data = await fetchWithRetry(url, headers);
  return Array.isArray(data.files) ? data.files.map(f => f.filename) : [];
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  if (dateIdx === -1 || !args[dateIdx + 1]) {
    console.error('Usage: node scripts/detect-plan-specs.js --date <M/D>');
    process.exit(1);
  }
  const date = args[dateIdx + 1];

  // Load commits data
  const commitsPath = path.join(ROOT, 'public/gitlab-commits.json');
  if (!fs.existsSync(commitsPath)) {
    console.error('public/gitlab-commits.json not found');
    process.exit(1);
  }
  const commitsData = JSON.parse(fs.readFileSync(commitsPath, 'utf8'));
  const dateCommits = commitsData.commits?.[date];
  if (!dateCommits) {
    console.error(`No commits found for date ${date}`);
    console.log(JSON.stringify([]));
    process.exit(0);
  }

  // Filter by keywords
  const candidates = filterSpecCommits(dateCommits);
  if (candidates.length === 0) {
    console.log(JSON.stringify([]));
    process.exit(0);
  }
  console.error(`Found ${candidates.length} spec-keyword candidates for ${date}`);

  // Load API configs
  const gitlabConfigPath = path.join(ROOT, 'gitlab-config.json');
  if (!fs.existsSync(gitlabConfigPath)) {
    console.error('gitlab-config.json not found (required)');
    process.exit(1);
  }
  const gitlabConfig = JSON.parse(fs.readFileSync(gitlabConfigPath, 'utf8'));

  let githubConfig = null;
  const githubConfigPath = path.join(ROOT, 'github-config.json');
  if (fs.existsSync(githubConfigPath)) {
    githubConfig = JSON.parse(fs.readFileSync(githubConfigPath, 'utf8'));
  } else {
    console.error('github-config.json not found (optional, GitHub commits will be skipped)');
  }

  // Fetch file changes for each candidate (max 50 API calls)
  const MAX_API_CALLS = 50;
  let apiCalls = 0;
  for (const candidate of candidates) {
    if (apiCalls >= MAX_API_CALLS) {
      console.error(`Reached max API calls (${MAX_API_CALLS}), stopping`);
      break;
    }
    const { commit } = candidate;
    try {
      let files;
      if (commit.source === 'github') {
        if (!githubConfig) continue;
        files = await fetchGitHubFiles(commit.project, commit.sha, commit.url, githubConfig);
      } else {
        files = await fetchGitLabDiff(commit.project, commit.sha, gitlabConfig);
      }
      apiCalls++;
      candidate.files = files.filter(isDocFile);
      if (candidate.files.length > 0) {
        console.error(`  ${candidate.member}: ${commit.title} → ${candidate.files.length} doc file(s)`);
      }
    } catch (e) {
      console.error(`  ${candidate.member}: ${commit.sha} fetch failed (${e.message})`);
    }
  }

  // Output only candidates with doc files
  const results = candidates
    .filter(c => c.files.length > 0)
    .map(c => ({ date, ...c }));

  console.log(JSON.stringify(results, null, 2));
}

// Run CLI when executed directly
if (require.main === module) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = {
  matchesSpecKeyword,
  isDocFile,
  filterSpecCommits,
};
