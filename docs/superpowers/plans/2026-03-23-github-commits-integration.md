# GitHub Commits Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub commits collection alongside existing GitLab integration with cross-platform SHA dedup, source icons in dashboard, and source tracking in Spreadsheet.

**Architecture:** Independent collectors (GitLab + GitHub) run in parallel during Stage 1 of `/sync` DAG. Stage 2 merges, deduplicates by SHA+project, and runs consistency analysis. Dashboard and Spreadsheet show merged data with source attribution.

**Tech Stack:** Node.js scripts (https module), React 18 + TypeScript, Google Apps Script, Vitest + Playwright

**Spec:** `docs/superpowers/specs/2026-03-23-github-commits-integration-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `scripts/collect-github-commits.js` | GitHub collection-only script (Stage 1 DAG) |
| `scripts/fetch-github-commits.js` | Full GitHub pipeline: collect + analyze + POST |
| `github-config.json` (gitignored) | GitHub API config: token, org, memberMap |
| `.claude/skills/sync-github-commits.md` | Standalone `/sync-github-commits` skill |
| `tests/collect-github-commits.test.js` | Unit tests for GitHub collector |
| `tests/analyze-consistency-multifile.test.js` | Unit tests for multi-file dedup |
| `tests/commits-source-icon.test.tsx` | Frontend test for source icons |
| `tests/e2e/commits-source.spec.ts` | E2E test for source icons |

### Modified Files
| File | Change |
|------|--------|
| `scripts/fetch-gitlab-commits.js` | Add `source: "gitlab"` to `filterAndMapCommits`, `buildDashboardJSON`, `buildPostPayload` |
| `scripts/analyze-consistency.js` | Multi-file `--commits` arg, cross-platform SHA dedup before analysis |
| `scripts/prepare-task-analysis.js` | Update "GitLab Commits" → "Commits" in prompt text |
| `src/types.ts` | Add `source?` to `CommitItem` |
| `src/CommitsView.tsx` | Source icon per commit in detail table |
| `appscript/Code.gs` | Rename sheet/function, migration logic, source column, getCommitData update |
| `.claude/skills/sync.md` | Add Agent C for GitHub in Stage 1 |
| `.gitignore` | Add `github-config.json` |
| `CLAUDE.md` | Document GitHub integration |

---

### Task 1: Add `source` field to GitLab collector and shared functions

**Files:**
- Modify: `scripts/fetch-gitlab-commits.js:109-126` (filterAndMapCommits)
- Modify: `scripts/fetch-gitlab-commits.js:206-224` (buildDashboardJSON)
- Modify: `scripts/fetch-gitlab-commits.js:227-255` (buildPostPayload)
- Test: `tests/fetch-gitlab-commits.test.js`

- [ ] **Step 1: Write failing test — filterAndMapCommits includes source**

Add to `tests/fetch-gitlab-commits.test.js`:

```javascript
it('filterAndMapCommits includes source: "gitlab"', () => {
  const commits = [{ author_name: 'byron.you', committed_date: '2026-03-19T10:00:00+08:00', title: 'fix', short_id: '1234abcd', web_url: 'https://example.com' }];
  const result = filterAndMapCommits(commits, 'proj/repo', { 'byron.you': '日銜' }, []);
  expect(result[0].source).toBe('gitlab');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/fetch-gitlab-commits.test.js`
Expected: FAIL — `result[0].source` is `undefined`

- [ ] **Step 3: Add `source: "gitlab"` to filterAndMapCommits**

In `scripts/fetch-gitlab-commits.js:114-123`, add `source: 'gitlab'` to the pushed object:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/fetch-gitlab-commits.test.js`
Expected: PASS

- [ ] **Step 5: Write failing test — buildDashboardJSON propagates source**

```javascript
it('buildDashboardJSON propagates source to items', () => {
  const commits = [
    { member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'p1', title: 'fix', sha: '1234abcd', url: 'http://x', unmapped: false, source: 'gitlab' },
  ];
  const result = buildDashboardJSON(commits, {}, []);
  expect(result.commits['3/19']['A'].items[0].source).toBe('gitlab');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun run test -- tests/fetch-gitlab-commits.test.js`
Expected: FAIL — `source` is `undefined` in items

- [ ] **Step 7: Add `source: c.source` to buildDashboardJSON**

In `scripts/fetch-gitlab-commits.js:222`, change:

```javascript
// Before:
m.items.push({ title: c.title, sha: c.sha, project: c.project, url: c.url, datetime: c.datetime });
// After:
m.items.push({ title: c.title, sha: c.sha, project: c.project, url: c.url, datetime: c.datetime, source: c.source });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run test -- tests/fetch-gitlab-commits.test.js`
Expected: PASS

- [ ] **Step 9: Write failing test — buildPostPayload includes source**

```javascript
it('buildPostPayload includes source in commit entries', () => {
  const commits = [
    { member: 'A', date: '3/19', project: 'p1', title: 'fix', sha: '1234abcd', url: 'http://x', unmapped: false, source: 'gitlab' },
  ];
  const analysisResult = { analysis: { '3/19': { 'A': { status: '✅', commitCount: 1, hours: 8 } } }, projectRisks: [] };
  const result = buildPostPayload(commits, analysisResult);
  expect(result.gitlabCommits[0].source).toBe('gitlab');
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `bun run test -- tests/fetch-gitlab-commits.test.js`
Expected: FAIL — `source` is `undefined`

- [ ] **Step 11: Add `source: c.source` to buildPostPayload**

In `scripts/fetch-gitlab-commits.js:236`, change:

```javascript
// Before:
gitlabCommits.push({ date: c.date, member: c.member, project: c.project, title: c.title, sha: c.sha, url: c.url });
// After:
gitlabCommits.push({ date: c.date, member: c.member, project: c.project, title: c.title, sha: c.sha, url: c.url, source: c.source });
```

- [ ] **Step 12: Run test to verify it passes**

Run: `bun run test -- tests/fetch-gitlab-commits.test.js`
Expected: PASS

- [ ] **Step 13: Run full test suite**

Run: `bun run test`
Expected: All tests pass (existing tests unaffected by additive field)

- [ ] **Step 14: Commit**

```bash
git add scripts/fetch-gitlab-commits.js tests/fetch-gitlab-commits.test.js
git commit -m "feat: add source field to GitLab collector and shared functions"
```

---

### Task 2: Extend `analyze-consistency.js` for multi-file input + cross-platform dedup

**Files:**
- Modify: `scripts/analyze-consistency.js:31-39`
- Create: `tests/analyze-consistency-multifile.test.js`

- [ ] **Step 1: Write failing tests for multi-file merge and dedup**

Create `tests/analyze-consistency-multifile.test.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'analyze-consistency.js');

// Helper to write temp files
function writeTmp(name, data) {
  const p = path.join(ROOT, 'test-results', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

describe('analyze-consistency multi-file', () => {
  const gitlabCommits = [
    { member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'shared-repo', title: 'fix bug', sha: '1234abcd', url: 'http://gitlab/1', unmapped: false, source: 'gitlab' },
    { member: 'A', date: '3/19', datetime: '2026-03-19T11:00:00Z', project: 'gitlab-only', title: 'add feat', sha: '5678efgh', url: 'http://gitlab/2', unmapped: false, source: 'gitlab' },
  ];
  const githubCommits = [
    { member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'shared-repo', title: 'fix bug', sha: '1234abcd', url: 'http://github/1', unmapped: false, source: 'github' },
    { member: 'B', date: '3/19', datetime: '2026-03-19T12:00:00Z', project: 'github-only', title: 'new feature', sha: 'abcd1234', url: 'http://github/2', unmapped: false, source: 'github' },
  ];

  it('accepts multiple --commits files', () => {
    const f1 = writeTmp('gl.json', gitlabCommits);
    const f2 = writeTmp('gh.json', githubCommits);
    // Should not throw
    const result = execSync(`node ${SCRIPT} --commits ${f1} ${f2} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits).toBeDefined();
  });

  it('deduplicates by sha|project across files (keeps first/GitLab)', () => {
    const f1 = writeTmp('gl2.json', gitlabCommits);
    const f2 = writeTmp('gh2.json', githubCommits);
    const result = execSync(`node ${SCRIPT} --commits ${f1} ${f2} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    // sha 1234abcd|shared-repo appears in both — should keep GitLab (first), total 3 unique commits
    expect(payload.gitlabCommits.length).toBe(3);
    const duped = payload.gitlabCommits.filter(c => c.sha === '1234abcd' && c.project === 'shared-repo');
    expect(duped.length).toBe(1);
    expect(duped[0].source).toBe('gitlab');
  });

  it('same SHA different project keeps both', () => {
    const gl = [{ member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'repo-a', title: 'fix', sha: 'aaaabbbb', url: 'http://gl/1', unmapped: false, source: 'gitlab' }];
    const gh = [{ member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'repo-b', title: 'fix', sha: 'aaaabbbb', url: 'http://gh/1', unmapped: false, source: 'github' }];
    const f1 = writeTmp('gl3.json', gl);
    const f2 = writeTmp('gh3.json', gh);
    const result = execSync(`node ${SCRIPT} --commits ${f1} ${f2} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits.length).toBe(2);
  });

  it('single file input still works (backward compat)', () => {
    const f1 = writeTmp('gl4.json', gitlabCommits);
    const result = execSync(`node ${SCRIPT} --commits ${f1} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/analyze-consistency-multifile.test.js`
Expected: FAIL — script only reads single file, second file arg ignored

- [ ] **Step 3: Implement multi-file parsing and dedup in analyze-consistency.js**

Replace lines 31-39 of `scripts/analyze-consistency.js`:

```javascript
async function main() {
  const args = process.argv.slice(2);
  const commitsPaths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commits') {
      for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) {
        commitsPaths.push(args[j]);
      }
    }
  }
  if (commitsPaths.length === 0) { console.error('Usage: node analyze-consistency.js --commits <path> [<path2> ...]'); process.exit(1); }

  // Read and merge all commit files
  let allCommits = [];
  for (const p of commitsPaths) {
    allCommits.push(...JSON.parse(fs.readFileSync(p, 'utf8')));
  }

  // Cross-platform dedup: sha|project, keep first occurrence (GitLab listed first = priority)
  const seen = new Set();
  allCommits = allCommits.filter(c => {
    const key = `${c.sha}|${c.project}`;
    if (seen.has(key)) {
      console.error(`Dedup: commit ${c.sha} found on both platforms for project ${c.project}`);
      return false;
    }
    seen.add(key);
    return true;
  });
```

The rest of `main()` (from `// Load raw_data.json` onward) stays unchanged — it already uses `allCommits`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/analyze-consistency-multifile.test.js`
Expected: All 4 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add scripts/analyze-consistency.js tests/analyze-consistency-multifile.test.js
git commit -m "feat: support multi-file commits input with cross-platform SHA dedup"
```

---

### Task 3: Create GitHub collection script

**Files:**
- Create: `scripts/collect-github-commits.js`
- Create: `tests/collect-github-commits.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/collect-github-commits.test.js`:

```javascript
// Tests that the module exists and exports collectGitHubCommits
describe('collect-github-commits', () => {
  it('script file exists', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(path.join(__dirname, '..', 'scripts', 'collect-github-commits.js'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/collect-github-commits.test.js`
Expected: FAIL — file doesn't exist

- [ ] **Step 3: Create `scripts/collect-github-commits.js`**

```javascript
#!/usr/bin/env node
'use strict';
const { collectGitHubCommits } = require('./fetch-github-commits');

async function main() {
  const args = process.argv.slice(2);
  let dateArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) { dateArg = args[i + 1]; i++; }
  }
  const { allCommits } = await collectGitHubCommits(dateArg);
  console.log(JSON.stringify(allCommits, null, 2));
  console.error(`\nDone: ${allCommits.length} GitHub commits collected`);
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}
```

Note: This depends on `fetch-github-commits.js` (Task 4). For now, create a stub `fetch-github-commits.js` that exports `collectGitHubCommits`:

```javascript
// Stub — will be fully implemented in Task 4
async function collectGitHubCommits(dateArg) { return { allCommits: [] }; }
module.exports = { collectGitHubCommits };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/collect-github-commits.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/collect-github-commits.js scripts/fetch-github-commits.js tests/collect-github-commits.test.js
git commit -m "feat: add GitHub collection script (stub)"
```

---

### Task 4: Implement full GitHub collection pipeline

**Files:**
- Modify: `scripts/fetch-github-commits.js` (replace stub)
- Create: `github-config.json` (template, gitignored)
- Modify: `.gitignore`

- [ ] **Step 1: Write tests for GitHub API helpers**

Add to `tests/collect-github-commits.test.js`:

```javascript
const { parseLinkHeader, filterAndMapGitHubCommits } = require('../scripts/fetch-github-commits');
const { parseDateArg, mdToISO, getPreviousWorkday } = require('../scripts/fetch-gitlab-commits');

describe('GitHub API helpers', () => {
  describe('parseLinkHeader', () => {
    it('parses next page URL from Link header', () => {
      const header = '<https://api.github.com/orgs/bigdata-54837596/repos?page=2&per_page=100>; rel="next", <https://api.github.com/orgs/bigdata-54837596/repos?page=5&per_page=100>; rel="last"';
      expect(parseLinkHeader(header)).toBe('https://api.github.com/orgs/bigdata-54837596/repos?page=2&per_page=100');
    });

    it('returns null when no next link', () => {
      const header = '<https://api.github.com/orgs/bigdata-54837596/repos?page=5&per_page=100>; rel="last"';
      expect(parseLinkHeader(header)).toBe(null);
    });

    it('returns null for empty/null header', () => {
      expect(parseLinkHeader(null)).toBe(null);
      expect(parseLinkHeader('')).toBe(null);
    });
  });

  describe('filterAndMapGitHubCommits', () => {
    const memberMap = { 'johndoe': '成員A', 'janedoe': '成員B' };
    const excludeAuthors = ['dependabot[bot]'];

    it('maps author login to member name', () => {
      const commits = [{ sha: 'abcdef1234567890abcdef1234567890abcdef12', commit: { message: 'fix bug', committer: { date: '2026-03-19T10:00:00Z' } }, author: { login: 'johndoe' } }];
      const result = filterAndMapGitHubCommits(commits, 'repo-name', memberMap, excludeAuthors);
      expect(result).toHaveLength(1);
      expect(result[0].member).toBe('成員A');
      expect(result[0].source).toBe('github');
      expect(result[0].sha).toBe('abcdef12'); // truncated to 8 chars
      expect(result[0].unmapped).toBe(false);
    });

    it('excludes bots', () => {
      const commits = [{ sha: 'abcd1234abcd1234abcd1234abcd1234abcd1234', commit: { message: 'bump dep', committer: { date: '2026-03-19T10:00:00Z' } }, author: { login: 'dependabot[bot]' } }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result).toHaveLength(0);
    });

    it('marks unmapped authors', () => {
      const commits = [{ sha: '1234abcd1234abcd1234abcd1234abcd1234abcd', commit: { message: 'test', committer: { date: '2026-03-19T10:00:00Z' } }, author: { login: 'unknownuser' } }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result[0].unmapped).toBe(true);
      expect(result[0].member).toBe('unknownuser');
    });

    it('handles null author (CLI commits)', () => {
      const commits = [{ sha: 'deadbeef12345678deadbeef12345678deadbeef', commit: { message: 'test', committer: { date: '2026-03-19T10:00:00Z', name: 'John Doe' } }, author: null }];
      const result = filterAndMapGitHubCommits(commits, 'repo', memberMap, excludeAuthors);
      expect(result[0].member).toBe('John Doe');
      expect(result[0].unmapped).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/collect-github-commits.test.js`
Expected: FAIL — `parseLinkHeader` and `filterAndMapGitHubCommits` not exported

- [ ] **Step 3: Implement `scripts/fetch-github-commits.js`**

Replace the stub with full implementation:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  parseDateArg, dateToMD, mdToISO, getPreviousWorkday,
  buildAnalysis, buildDashboardJSON, buildPostPayload,
} = require('./fetch-gitlab-commits');

const ROOT = path.resolve(__dirname, '..');

// --- GitHub API Helpers ---

function parseLinkHeader(header) {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
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
          const nextUrl = parseLinkHeader(res.headers['link']);
          resolve({ body, nextUrl });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllGitHubPages(url, token) {
  const results = [];
  let currentUrl = url;
  while (currentUrl) {
    const resp = await fetchGitHubJSON(currentUrl, token);
    if (Array.isArray(resp.body)) results.push(...resp.body);
    currentUrl = resp.nextUrl;
  }
  return results;
}

// --- Commit Filtering ---

function filterAndMapGitHubCommits(commits, repoName, memberMap, excludeAuthors) {
  const results = [];
  for (const c of commits) {
    const authorLogin = c.author ? c.author.login : null;
    const authorName = authorLogin || (c.commit && c.commit.committer ? c.commit.committer.name : 'unknown');
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
  const { baseUrl = 'https://api.github.com', org, token, memberMap, excludeAuthors = [] } = config;

  const dateRange = dateArg ? parseDateArg(dateArg) : { since: getPreviousWorkday(), until: getPreviousWorkday() };
  const sinceISO = mdToISO(dateRange.since);
  const untilISO = mdToISO(dateRange.until, true);

  console.error(`Fetching GitHub commits for ${dateRange.since}${dateRange.since !== dateRange.until ? '-' + dateRange.until : ''}...`);

  // Fetch all repos in org
  const reposUrl = `${baseUrl}/orgs/${org}/repos?per_page=100&sort=pushed&direction=desc`;
  const repos = await fetchAllGitHubPages(reposUrl, token);
  console.error(`Found ${repos.length} repos in ${org}`);

  const allCommits = [];
  const warnings = [];
  for (const repo of repos) {
    const commitsUrl = `${baseUrl}/repos/${org}/${repo.name}/commits?since=${encodeURIComponent(sinceISO)}&until=${encodeURIComponent(untilISO)}&per_page=100`;
    try {
      const rawCommits = await fetchAllGitHubPages(commitsUrl, token);
      if (rawCommits.length === 0) continue;
      const mapped = filterAndMapGitHubCommits(rawCommits, repo.full_name, memberMap, excludeAuthors);
      for (const c of mapped) {
        if (c.unmapped && !warnings.includes(c.member)) warnings.push(c.member);
      }
      allCommits.push(...mapped.filter(c => !c.unmapped));
      console.error(`  ${repo.full_name}: ${rawCommits.length} commits (${mapped.filter(c => !c.unmapped).length} mapped)`);
    } catch (e) {
      if (e.message.includes('token') || e.message === 'RATE_LIMITED') throw e;
      continue;
    }
  }

  if (warnings.length > 0) {
    console.error(`\nWarning: unmapped GitHub authors: ${warnings.join(', ')}`);
  }

  return { config, dateRange, allCommits };
}

// --- Main (standalone full pipeline) ---

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

  // Read existing gitlab-commits.json for cross-platform dedup
  const gitlabJsonPath = path.join(ROOT, 'public', 'gitlab-commits.json');
  const existingSHAs = new Set();
  if (fs.existsSync(gitlabJsonPath)) {
    const existingData = JSON.parse(fs.readFileSync(gitlabJsonPath, 'utf8'));
    for (const members of Object.values(existingData.commits || {})) {
      for (const memberData of Object.values(members)) {
        for (const item of memberData.items || []) {
          existingSHAs.add(`${item.sha}|${item.project}`);
        }
      }
    }
  }

  // Filter out commits that already exist (cross-platform dedup)
  const dedupedCommits = allCommits.filter(c => {
    const key = `${c.sha}|${c.project}`;
    if (existingSHAs.has(key)) {
      console.error(`Dedup: GitHub commit ${c.sha} already in GitLab data for ${c.project}`);
      return false;
    }
    return true;
  });

  // Merge with existing GitLab commits for analysis
  const existingCommits = [];
  if (fs.existsSync(gitlabJsonPath)) {
    const existingData = JSON.parse(fs.readFileSync(gitlabJsonPath, 'utf8'));
    for (const [date, members] of Object.entries(existingData.commits || {})) {
      for (const [member, memberData] of Object.entries(members)) {
        for (const item of memberData.items || []) {
          existingCommits.push({
            member, date, project: item.project, title: item.title,
            sha: item.sha, url: item.url, datetime: item.datetime,
            unmapped: false, source: item.source || 'gitlab',
          });
        }
      }
    }
  }

  const mergedCommits = [...existingCommits, ...dedupedCommits];

  // Build analysis with merged data
  const analysisResult = buildAnalysis(mergedCommits, existing.rawData, dailyUpdateMembers);
  const dashboardData = buildDashboardJSON(mergedCommits, analysisResult.analysis, analysisResult.projectRisks);

  // Write merged gitlab-commits.json
  const { dedupCommitItems } = require('./analyze-consistency');
  dedupCommitItems(dashboardData);
  fs.writeFileSync(gitlabJsonPath, JSON.stringify(dashboardData, null, 2));
  console.error(`\nWrote gitlab-commits.json (merged with GitHub data)`);

  // Output POST payload to stdout
  const postPayload = buildPostPayload(mergedCommits, analysisResult);
  console.log(JSON.stringify(postPayload, null, 2));
  console.error(`\nDone: ${dedupedCommits.length} new GitHub commits, ${mergedCommits.length} total`);
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}

module.exports = {
  collectGitHubCommits,
  parseLinkHeader,
  filterAndMapGitHubCommits,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/collect-github-commits.test.js`
Expected: All tests PASS

- [ ] **Step 5: Add `github-config.json` to `.gitignore`**

In `.gitignore`, add after `gitlab-config.json`:

```
github-config.json
```

- [ ] **Step 6: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-github-commits.js scripts/collect-github-commits.js tests/collect-github-commits.test.js .gitignore
git commit -m "feat: implement GitHub commits collection pipeline"
```

---

### Task 5: Update frontend types and CommitsView source icons

**Files:**
- Modify: `src/types.ts:20-26`
- Modify: `src/CommitsView.tsx:340-360`
- Create: `tests/components/commits-source-icon.test.tsx`

- [ ] **Step 1: Write failing test for source icon rendering**

Create `tests/components/commits-source-icon.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Must mock recharts — CommitsView imports ScatterChart, BarChart, etc.
vi.mock("recharts", () => import("../__mocks__/recharts"));

import CommitsView from '../../src/CommitsView';

const makeCommitData = (source?: 'gitlab' | 'github') => ({
  commits: {
    '3/19': {
      'A': {
        count: 1,
        projects: ['repo-1'],
        items: [{ title: 'fix bug', sha: '1234abcd', project: 'repo-1', url: 'http://example.com', source }],
      },
    },
  },
  analysis: { '3/19': { 'A': { status: '✅', commitCount: 1, hours: 8 } } },
  projectRisks: [],
});

const defaultProps = {
  dates: ['3/19'],
  members: ['A'],
  memberColors: { A: '#ff0000' },
  leave: {},
  activeDate: '3/19',
  onDateSelect: () => {},
  dailyDates: ['3/19'],
  dayLabels: { '3/19': '三' },
  taskAnalysisData: null,
};

describe('CommitsView source icons', () => {
  it('renders GitLab icon (🦊) for source: "gitlab"', () => {
    render(<CommitsView commitData={makeCommitData('gitlab')} {...defaultProps} />);
    // Click to expand member
    screen.getByText('A').click();
    expect(screen.getByText('🦊')).toBeDefined();
  });

  it('renders GitHub icon (🐙) for source: "github"', () => {
    render(<CommitsView commitData={makeCommitData('github')} {...defaultProps} />);
    screen.getByText('A').click();
    expect(screen.getByText('🐙')).toBeDefined();
  });

  it('defaults to GitLab icon when source is undefined', () => {
    render(<CommitsView commitData={makeCommitData(undefined)} {...defaultProps} />);
    screen.getByText('A').click();
    expect(screen.getByText('🦊')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/components/commits-source-icon.test.tsx`
Expected: FAIL — no emoji icons rendered, `source` not on CommitItem type

- [ ] **Step 3: Add `source` to `CommitItem` in `src/types.ts`**

Change `src/types.ts:20-26`:

```typescript
export interface CommitItem {
  title: string;
  sha: string;
  project: string;
  url: string;
  datetime?: string;
  source?: 'gitlab' | 'github';
}
```

- [ ] **Step 4: Add source icon to CommitsView commit detail table**

In `src/CommitsView.tsx:343-346`, add a source icon `<td>` before the time column:

```tsx
{items.sort((a, b) => (b.datetime || '').localeCompare(a.datetime || '')).map((item, i) => (
  <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
    <td style={{ padding: "4px 6px", width: 24, fontSize: 13, textAlign: "center" }}
      title={item.source === 'github' ? 'GitHub' : 'GitLab'}>
      {item.source === 'github' ? '🐙' : '🦊'}
    </td>
    <td style={{ padding: "4px 8px", color: COLORS.textMuted, width: 50, fontSize: 11 }}
      title={item.datetime || ''}>{item.datetime ? new Date(item.datetime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' }) : '—'}</td>
    <td style={{ padding: "4px 8px", color: COLORS.teal, width: 120, fontSize: 11 }}>{item.project.split('/').pop()}</td>
    <td style={{ padding: "4px 8px", color: COLORS.text }}>{item.title}</td>
    <td style={{ padding: "4px 8px", width: 70 }}>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer"
          style={{ color: COLORS.teal, fontFamily: "JetBrains Mono, SF Mono, monospace", fontSize: 11, textDecoration: "none" }}
          onMouseOver={e => (e.target as HTMLElement).style.textDecoration = "underline"}
          onMouseOut={e => (e.target as HTMLElement).style.textDecoration = "none"}
        >{item.sha}</a>
      ) : (
        <span style={{ color: COLORS.textDim, fontFamily: "JetBrains Mono, SF Mono, monospace", fontSize: 11 }}>{item.sha}</span>
      )}
    </td>
  </tr>
))}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- tests/components/commits-source-icon.test.tsx`
Expected: All 3 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/CommitsView.tsx tests/components/commits-source-icon.test.tsx
git commit -m "feat: add source icons to commit detail table"
```

---

### Task 6: Update Apps Script (`Code.gs`)

**Files:**
- Modify: `appscript/Code.gs:38,165-195,238-261,455-460`

- [ ] **Step 1: Rename `writeGitlabCommits_` to `writeCommits_` with migration**

Replace `writeGitlabCommits_` function (lines 165-195) with:

```javascript
function writeCommits_(ss, commits) {
  // Migration: try "Commits" first, fall back to "GitLab Commits" (rename + backfill)
  var sheet = ss.getSheetByName('Commits');
  if (!sheet) {
    var oldSheet = ss.getSheetByName('GitLab Commits');
    if (oldSheet) {
      // Migrate: rename sheet, add source column header, backfill "gitlab"
      oldSheet.setName('Commits');
      sheet = oldSheet;
      var lastRow = sheet.getLastRow();
      if (lastRow >= 1) {
        sheet.getRange(1, 7).setValue('Source');
        if (lastRow > 1) {
          var fillValues = [];
          for (var r = 0; r < lastRow - 1; r++) fillValues.push(['gitlab']);
          sheet.getRange(2, 7, lastRow - 1, 1).setValues(fillValues);
        }
      }
    } else {
      sheet = ss.insertSheet('Commits');
    }
  }

  // Read existing rows for deduplication by date|member|sha
  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    var key = formatDate_(existing[i][0]) + '|' + String(existing[i][1]) + '|' + String(existing[i][4]);
    existingKeys[key] = true;
  }

  // Add header if empty
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 7).setValues([['日期', '成員', 'Project', 'Commit Title', 'SHA', 'URL', 'Source']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var i = 0; i < commits.length; i++) {
    var c = commits[i];
    var key = String(c.date) + '|' + String(c.member) + '|' + String(c.sha);
    if (existingKeys[key]) continue;
    newRows.push([c.date, c.member, c.project, c.title, c.sha, c.url || '', c.source || 'gitlab']);
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 7).setValues(newRows);
  }
}
```

- [ ] **Step 2: Update `doPost` to call `writeCommits_`**

Change line 38:

```javascript
// Before:
if (data.gitlabCommits) writeGitlabCommits_(ss, data.gitlabCommits);
// After:
if (data.gitlabCommits) writeCommits_(ss, data.gitlabCommits);
```

- [ ] **Step 3: Update `DEDUP_KEY_CONFIG`**

Replace lines 455-460:

```javascript
var DEDUP_KEY_CONFIG = {
  'Daily Updates':    { cols: [0, 1], dateCols: [0] },       // date|member
  'Commits':          { cols: [0, 1, 4], dateCols: [0] },    // date|member|sha
  'GitLab Commits':   { cols: [0, 1, 4], dateCols: [0] },    // date|member|sha (pre-migration)
  'Commit Analysis':  { cols: [0, 1], dateCols: [0] },       // date|member
  'Task Analysis':    { cols: [1, 2, 3], dateCols: [2] },    // period|date|member
};
```

- [ ] **Step 4: Update `getCommitData()` for new sheet name + source field**

Replace `getCommitData()` (lines 238-304):

```javascript
function getCommitData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var commitSheet = ss.getSheetByName('Commits') || ss.getSheetByName('GitLab Commits');
  if (!commitSheet) return JSON.stringify(null);

  var commitRows = commitSheet.getDataRange().getValues();
  var numCols = commitRows.length > 0 ? commitRows[0].length : 0;
  var hasSource = numCols >= 7;
  var commits = {};
  for (var i = 1; i < commitRows.length; i++) {
    var date = formatDate_(commitRows[i][0]);
    var member = String(commitRows[i][1]);
    var project = String(commitRows[i][2]);
    var title = String(commitRows[i][3]);
    var sha = String(commitRows[i][4]);
    if (!date || !member) continue;

    if (!commits[date]) commits[date] = {};
    if (!commits[date][member]) commits[date][member] = { count: 0, projects: [], items: [] };
    commits[date][member].count++;
    if (commits[date][member].projects.indexOf(project) === -1) {
      commits[date][member].projects.push(project);
    }
    var url = String(commitRows[i][5] || '');
    var source = hasSource ? String(commitRows[i][6] || 'gitlab') : 'gitlab';
    commits[date][member].items.push({ title: title, sha: sha, project: project, url: url || null, source: source });
  }

  // Read analysis (unchanged)
  var analysisSheet = ss.getSheetByName('Commit Analysis');
  var analysis = {};
  var projectRisks = [];
  if (analysisSheet) {
    var analysisRows = analysisSheet.getDataRange().getValues();
    var projectContributors = {};
    for (var i = 1; i < analysisRows.length; i++) {
      var date = formatDate_(analysisRows[i][0]);
      var member = String(analysisRows[i][1]);
      var commitCount = Number(analysisRows[i][2]) || 0;
      var hours = analysisRows[i][3] === '' || analysisRows[i][3] === null ? null : Number(analysisRows[i][3]);
      var status = String(analysisRows[i][4]);
      var projects = String(analysisRows[i][5]);
      if (!date || !member) continue;

      if (!analysis[date]) analysis[date] = {};
      analysis[date][member] = { status: status, commitCount: commitCount, hours: hours };

      if (projects) {
        var projList = projects.split(', ');
        for (var j = 0; j < projList.length; j++) {
          if (!projectContributors[projList[j]]) projectContributors[projList[j]] = {};
          projectContributors[projList[j]][member] = true;
        }
      }
    }

    var projNames = Object.keys(projectContributors);
    for (var i = 0; i < projNames.length; i++) {
      var contributors = Object.keys(projectContributors[projNames[i]]);
      if (contributors.length === 1) {
        projectRisks.push({ project: projNames[i], soloContributor: contributors[0], severity: '🟡' });
      }
    }
  }

  return JSON.stringify({ commits: commits, analysis: analysis, projectRisks: projectRisks });
}
```

- [ ] **Step 5: Build Apps Script to verify no syntax errors**

Run: `bun run build:appscript`
Expected: Successful build (generates `appscript/index.html`)

- [ ] **Step 6: Manual verification checklist**

After deploying to Apps Script (`bun run deploy:appscript`), verify:
- [ ] `writeCommits_()` creates "Commits" sheet on fresh spreadsheet
- [ ] On existing spreadsheet with "GitLab Commits" sheet, migration renames to "Commits" + adds Source column
- [ ] `getCommitData()` reads from "Commits" sheet and includes `source` in items
- [ ] Dedup works with both "Commits" and "GitLab Commits" sheet names

- [ ] **Step 7: Commit**

```bash
git add appscript/Code.gs
git commit -m "feat: update Apps Script for multi-source commits with sheet migration"
```

---

### Task 7: Update `prepare-task-analysis.js` prompt text

**Files:**
- Modify: `scripts/prepare-task-analysis.js`

- [ ] **Step 1: Update "GitLab Commits" references in prompt text**

Find and replace in `scripts/prepare-task-analysis.js`:
- `### GitLab Commits (same day):` → `### Commits (same day):`
- `每日回報任務與 GitLab commit 記錄的合理性` → `每日回報任務與 commit 記錄的合理性`

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add scripts/prepare-task-analysis.js
git commit -m "fix: update task analysis prompt to be platform-neutral"
```

---

### Task 8: Update skills and documentation

**Files:**
- Modify: `.claude/skills/sync.md`
- Create: `.claude/skills/sync-github-commits.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `/sync` skill — add Agent C**

In `.claude/skills/sync.md`, add Agent C to Stage 1 parallel collection and update Stage 2 to pass both files:

Stage 1: Add parallel agent for `node scripts/collect-github-commits.js --date <M/D> > /tmp/github-commits-<date>.json`

Stage 2: Change `analyze-consistency.js --commits /tmp/gitlab-commits-<date>.json` to `analyze-consistency.js --commits /tmp/gitlab-commits-<date>.json /tmp/github-commits-<date>.json`

- [ ] **Step 2: Create `/sync-github-commits` skill**

Create `.claude/skills/sync-github-commits.md` — symmetric to `sync-gitlab-commits.md`, using `scripts/fetch-github-commits.js`, reading `github-config.json`, supporting date ranges and backfill.

- [ ] **Step 3: Update `CLAUDE.md`**

Add to Architecture section:
- `github-config.json` description
- `scripts/collect-github-commits.js` and `scripts/fetch-github-commits.js` descriptions
- Note about `public/gitlab-commits.json` containing both GitLab and GitHub commits with `source` field
- Update schema section to show `source` in CommitItem

Add to Slash Commands table:
- `/sync-github-commits` entry

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/sync.md .claude/skills/sync-github-commits.md CLAUDE.md
git commit -m "docs: update skills and CLAUDE.md for GitHub integration"
```

---

### Task 9: E2E tests with Playwright

**Files:**
- Create: `tests/e2e/commits-source.spec.ts`

- [ ] **Step 1: Create E2E test for source icons**

Create `tests/e2e/commits-source.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Commits source icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to Commits tab
    await page.click('text=Commits');
  });

  test('shows source icon in commit detail', async ({ page }) => {
    // Find and expand a member's commits
    const memberButton = page.locator('button:has-text("commits")').first();
    if (await memberButton.isVisible()) {
      await memberButton.click();
      // Should see either 🦊 or 🐙 icon
      const icons = page.locator('td:has-text("🦊"), td:has-text("🐙")');
      expect(await icons.count()).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `bunx playwright test tests/e2e/commits-source.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/commits-source.spec.ts
git commit -m "test: add E2E test for commit source icons"
```

---

### Task 10: Create `github-config.json` template and final validation

**Files:**
- Verify: all tests pass
- Create: `github-config.example.json` (optional, for reference)

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 2: Run E2E tests**

Run: `bunx playwright test`
Expected: All E2E tests pass

- [ ] **Step 3: Build and verify**

Run: `bun run build`
Expected: Successful build with no TypeScript errors

- [ ] **Step 4: Final review — no uncommitted changes**

Run: `git status`
Expected: All changes committed in previous tasks. If any stray files remain, stage them explicitly (not `git add -A`).
