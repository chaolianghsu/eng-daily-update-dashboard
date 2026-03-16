# GitLab Commits x Daily Update Correlation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch GitLab commits for engineering team members, correlate with daily update data, write results to Google Spreadsheet and local JSON, and visualize in the dashboard.

**Architecture:** Node.js script reads `gitlab-config.json`, calls GitLab API, cross-references `raw_data.json` for analysis, outputs `gitlab-commits.json` (dashboard) + POST payload (Spreadsheet). Dashboard fetches both JSON files and renders a new Commits tab plus enhancements to existing views.

**Tech Stack:** Node.js (native `https`/`fs`), Vitest, React 18 + Recharts (CDN, in-browser JSX), Google Apps Script

**Spec:** `docs/superpowers/specs/2026-03-16-gitlab-commits-correlation-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `gitlab-config.json` | Modify | Add `memberMap` and `excludeAuthors` |
| `scripts/fetch-gitlab-commits.js` | Create | GitLab API fetch, filter, analysis, output |
| `gitlab-commits.json` | Create (generated) | Dashboard data: commits, analysis, projectRisks |
| `tests/fetch-gitlab-commits.test.js` | Create | Unit tests for date parsing, member mapping, analysis |
| `appscript/Code.gs` | Modify | Add `writeGitlabCommits_()`, `writeCommitAnalysis_()`, update `doPost()` |
| `index.html` | Modify | Commits tab, daily badges, trend overlay, issues integration |
| `.claude/skills/sync-gitlab-commits.md` | Create | Standalone sync skill |
| `.claude/skills/sync.md` | Create | Unified orchestration skill |

---

## Chunk 1: Backend — Config, Script, Tests

### Task 1: Update gitlab-config.json

**Files:**
- Modify: `gitlab-config.json`

- [ ] **Step 1: Add memberMap and excludeAuthors**

Read current `gitlab-config.json` (has only `baseUrl` and `token`). Add the full member mapping and exclusion list:

```json
{
  "baseUrl": "https://biglab.buygta.today",
  "token": "<existing token>",
  "memberMap": {
    "joyce.kuo": "Joyce",
    "joyce": "Joyce",
    "Ted Juang": "Ted",
    "ted.juang": "Ted",
    "aaron.li": "Aaron",
    "Aaron li": "Aaron",
    "Joe Lu": "Joe",
    "joe": "Joe",
    "Ivy Wang": "Ivy",
    "ivywang": "Ivy",
    "jason.liu": "Jason",
    "Jason Liu": "Jason",
    "byron.you": "日銜",
    "wendyHsieh": "Wendy",
    "Wendy Hsieh": "Wendy",
    "yuriy.lin": "侑呈",
    "chris.su": "禎佑",
    "block.lee": "家輝",
    "Block": "家輝",
    "mason": "哲緯",
    "chaoliang.hsu": "兆良",
    "walt.peng": "Walt"
  },
  "excludeAuthors": ["GitLab CI", "patty", "richard", "李耀瑄", "leohu"]
}
```

Preserve the existing token value. This file is gitignored — no commit needed.

- [ ] **Step 2: Verify file is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('gitlab-config.json','utf8')); console.log('OK')"
```

Expected: `OK`

---

### Task 2: fetch-gitlab-commits.js — Core Script

**Files:**
- Create: `scripts/fetch-gitlab-commits.js`
- Test: `tests/fetch-gitlab-commits.test.js`

#### Step Group A: Date Utilities

- [ ] **Step 1: Write date utility tests**

Create `tests/fetch-gitlab-commits.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  parseDateArg,
  dateToMD,
  mdToISO,
  getPreviousWorkday,
} from '../scripts/fetch-gitlab-commits.js';

describe('date utilities', () => {
  it('parseDateArg single date "3/11" returns { since: "3/11", until: "3/11" }', () => {
    expect(parseDateArg('3/11')).toEqual({ since: '3/11', until: '3/11' });
  });

  it('parseDateArg range "3/9-3/12" returns { since: "3/9", until: "3/12" }', () => {
    expect(parseDateArg('3/9-3/12')).toEqual({ since: '3/9', until: '3/12' });
  });

  it('dateToMD converts ISO timestamp to M/D', () => {
    expect(dateToMD('2026-03-11T10:30:00+08:00')).toBe('3/11');
  });

  it('mdToISO converts M/D to ISO start-of-day in +08:00', () => {
    const iso = mdToISO('3/11');
    expect(iso).toMatch(/2026-03-11T00:00:00/);
  });

  it('mdToISO for until adds one day', () => {
    const iso = mdToISO('3/11', true);
    expect(iso).toMatch(/2026-03-12T00:00:00/);
  });

  it('getPreviousWorkday skips weekends', () => {
    // 2026-03-16 is Monday → previous workday is Friday 3/13
    const result = getPreviousWorkday(new Date(2026, 2, 16));
    expect(result).toBe('3/13');
  });

  it('getPreviousWorkday from Friday returns Thursday', () => {
    // 2026-03-13 is Friday → previous workday is Thursday 3/12
    const result = getPreviousWorkday(new Date(2026, 2, 13));
    expect(result).toBe('3/12');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/fetch-gitlab-commits.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement date utilities**

Create `scripts/fetch-gitlab-commits.js` with the date utility functions:

```javascript
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

module.exports = { parseDateArg, dateToMD, mdToISO, getPreviousWorkday };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/fetch-gitlab-commits.test.js
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-gitlab-commits.js tests/fetch-gitlab-commits.test.js
git commit -m "feat: add date utilities for fetch-gitlab-commits"
```

#### Step Group B: GitLab API Fetching

- [ ] **Step 6: Write API fetch tests (mocked)**

Add to `tests/fetch-gitlab-commits.test.js`:

```javascript
import { filterAndMapCommits } from '../scripts/fetch-gitlab-commits.js';

describe('filterAndMapCommits', () => {
  const memberMap = { 'joyce.kuo': 'Joyce', 'Ted Juang': 'Ted' };
  const excludeAuthors = ['GitLab CI'];

  it('maps known authors to member names', () => {
    const commits = [
      { author_name: 'joyce.kuo', committed_date: '2026-03-11T10:00:00+08:00', short_id: 'abc123', title: '[feat] test' },
    ];
    const result = filterAndMapCommits(commits, 'KEYPO/backend', memberMap, excludeAuthors);
    expect(result).toHaveLength(1);
    expect(result[0].member).toBe('Joyce');
    expect(result[0].project).toBe('KEYPO/backend');
  });

  it('filters out excluded authors', () => {
    const commits = [
      { author_name: 'GitLab CI', committed_date: '2026-03-11T10:00:00+08:00', short_id: 'ci1', title: 'CI build' },
    ];
    const result = filterAndMapCommits(commits, 'proj', memberMap, excludeAuthors);
    expect(result).toHaveLength(0);
  });

  it('returns unmapped authors with original name and warning flag', () => {
    const commits = [
      { author_name: 'unknown.dev', committed_date: '2026-03-11T10:00:00+08:00', short_id: 'u1', title: 'fix' },
    ];
    const result = filterAndMapCommits(commits, 'proj', memberMap, excludeAuthors);
    expect(result).toHaveLength(1);
    expect(result[0].member).toBe('unknown.dev');
    expect(result[0].unmapped).toBe(true);
  });
});
```

- [ ] **Step 7: Run tests — expect FAIL**

```bash
npm test -- tests/fetch-gitlab-commits.test.js
```

Expected: FAIL — `filterAndMapCommits` not exported

- [ ] **Step 8: Implement filterAndMapCommits + API helpers**

Add to `scripts/fetch-gitlab-commits.js`:

```javascript
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
      project: projectPath,
      title: c.title,
      sha: c.short_id,
      unmapped: !member,
    });
  }
  return results;
}

// Update module.exports
module.exports = { parseDateArg, dateToMD, mdToISO, getPreviousWorkday, filterAndMapCommits, fetchAllPages };
```

- [ ] **Step 9: Run tests — expect PASS**

```bash
npm test -- tests/fetch-gitlab-commits.test.js
```

Expected: All 10 tests PASS

- [ ] **Step 10: Commit**

```bash
git add scripts/fetch-gitlab-commits.js tests/fetch-gitlab-commits.test.js
git commit -m "feat: add GitLab API fetch and commit filtering"
```

#### Step Group C: Analysis + Output

- [ ] **Step 11: Write analysis tests**

Add to `tests/fetch-gitlab-commits.test.js`:

```javascript
import { buildAnalysis } from '../scripts/fetch-gitlab-commits.js';

describe('buildAnalysis', () => {
  const rawData = {
    '3/11': {
      'Joyce': { total: 9, meeting: 1.5, dev: 7.5 },
      'Ted': { total: 7.5, meeting: 0, dev: 7.5 },
      'Aaron': { total: null, meeting: null, dev: null },
    },
  };
  const commits = [
    { member: 'Joyce', date: '3/11', project: 'backend', title: 'fix', sha: 'a1' },
    { member: 'Joyce', date: '3/11', project: 'backend', title: 'feat', sha: 'a2' },
    { member: 'Aaron', date: '3/11', project: 'agent', title: 'add', sha: 'b1' },
  ];
  const dailyUpdateMembers = ['Joyce', 'Ted', 'Aaron'];

  it('marks ✅ when both commits and hours present', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    expect(result.analysis['3/11']['Joyce'].status).toBe('✅');
    expect(result.analysis['3/11']['Joyce'].commitCount).toBe(2);
  });

  it('marks ⚠️ when hours reported but 0 commits', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    expect(result.analysis['3/11']['Ted'].status).toBe('⚠️');
  });

  it('marks 🔴 when commits exist but no daily update', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    expect(result.analysis['3/11']['Aaron'].status).toBe('🔴');
  });

  it('identifies single-contributor projects', () => {
    const result = buildAnalysis(commits, rawData, dailyUpdateMembers);
    const agentRisk = result.projectRisks.find(r => r.project === 'agent');
    expect(agentRisk).toBeDefined();
    expect(agentRisk.soloContributor).toBe('Aaron');
  });
});
```

- [ ] **Step 12: Run tests — expect FAIL**

```bash
npm test -- tests/fetch-gitlab-commits.test.js
```

Expected: FAIL — `buildAnalysis` not exported

- [ ] **Step 13: Implement buildAnalysis**

Add to `scripts/fetch-gitlab-commits.js`:

```javascript
// --- Analysis ---

function buildAnalysis(commits, rawData, dailyUpdateMembers) {
  // Group commits by date → member
  const commitsByDateMember = {};
  const projectContributors = {};

  for (const c of commits) {
    if (c.unmapped) continue;
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
  const allDates = [...new Set([...commitDates, ...Object.keys(rawData)])].sort((a, b) => {
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

// Update module.exports
module.exports = {
  parseDateArg, dateToMD, mdToISO, getPreviousWorkday,
  filterAndMapCommits, fetchAllPages, buildAnalysis,
};
```

- [ ] **Step 14: Run tests — expect PASS**

```bash
npm test -- tests/fetch-gitlab-commits.test.js
```

Expected: All 14 tests PASS

- [ ] **Step 15: Commit**

```bash
git add scripts/fetch-gitlab-commits.js tests/fetch-gitlab-commits.test.js
git commit -m "feat: add consistency analysis and project risk detection"
```

#### Step Group D: Main Function + CLI + gitlab-commits.json Output

- [ ] **Step 16: Implement main() and CLI**

Add to `scripts/fetch-gitlab-commits.js`:

```javascript
// --- Output ---

function buildDashboardJSON(commits, analysis, projectRisks) {
  // Group commits by date → member for dashboard format
  const commitsByDate = {};
  for (const c of commits) {
    if (c.unmapped) continue;
    if (!commitsByDate[c.date]) commitsByDate[c.date] = {};
    if (!commitsByDate[c.date][c.member]) {
      commitsByDate[c.date][c.member] = { count: 0, projects: [], items: [] };
    }
    const m = commitsByDate[c.date][c.member];
    m.count++;
    if (!m.projects.includes(c.project)) m.projects.push(c.project);
    m.items.push({ title: c.title, sha: c.sha, project: c.project });
  }
  return { commits: commitsByDate, analysis, projectRisks };
}

function buildPostPayload(commits, analysisResult) {
  // Flat arrays for Apps Script
  const gitlabCommits = commits.filter(c => !c.unmapped).map(c => ({
    date: c.date, member: c.member, project: c.project, title: c.title, sha: c.sha,
  }));

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

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  let dateArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) { dateArg = args[i + 1]; i++; }
  }

  // Load config
  const configPath = path.join(ROOT, 'gitlab-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Error: gitlab-config.json not found');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { baseUrl, token, memberMap, excludeAuthors = [] } = config;

  // Determine date range
  const dateRange = dateArg ? parseDateArg(dateArg) : { since: getPreviousWorkday(), until: getPreviousWorkday() };
  const sinceISO = mdToISO(dateRange.since);
  const untilISO = mdToISO(dateRange.until, true);

  console.error(`Fetching commits for ${dateRange.since}${dateRange.since !== dateRange.until ? '-' + dateRange.until : ''}...`);

  // Fetch projects
  const projectsUrl = `${baseUrl}/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at`;
  const projects = await fetchAllPages(projectsUrl, token);
  console.error(`Found ${projects.length} projects`);

  // Fetch commits for each project
  const allCommits = [];
  const warnings = [];
  for (const proj of projects) {
    const commitsUrl = `${baseUrl}/api/v4/projects/${proj.id}/repository/commits?since=${encodeURIComponent(sinceISO)}&until=${encodeURIComponent(untilISO)}&all=true&per_page=100`;
    try {
      const rawCommits = await fetchAllPages(commitsUrl, token);
      if (rawCommits.length === 0) continue;
      const mapped = filterAndMapCommits(rawCommits, proj.path_with_namespace, memberMap, excludeAuthors);
      // Collect unmapped warnings
      for (const c of mapped) {
        if (c.unmapped && !warnings.includes(c.member)) warnings.push(c.member);
      }
      allCommits.push(...mapped.filter(c => !c.unmapped));
      console.error(`  ${proj.path_with_namespace}: ${rawCommits.length} commits (${mapped.filter(c => !c.unmapped).length} mapped)`);
    } catch (e) {
      if (e.message.includes('token')) throw e;
      // Skip projects with no repository or other non-fatal errors
      continue;
    }
  }

  if (warnings.length > 0) {
    console.error(`\nWarning: unmapped authors: ${warnings.join(', ')}`);
  }

  // Load raw_data.json for analysis
  const rawDataPath = path.join(ROOT, 'raw_data.json');
  const existing = fs.existsSync(rawDataPath)
    ? JSON.parse(fs.readFileSync(rawDataPath, 'utf8'))
    : { rawData: {} };
  const dailyUpdateMembers = Object.keys(
    existing.rawData[Object.keys(existing.rawData).pop()] || {}
  );

  // Build analysis
  const analysisResult = buildAnalysis(allCommits, existing.rawData, dailyUpdateMembers);

  // Write gitlab-commits.json for dashboard
  const dashboardData = buildDashboardJSON(allCommits, analysisResult.analysis, analysisResult.projectRisks);
  fs.writeFileSync(path.join(ROOT, 'gitlab-commits.json'), JSON.stringify(dashboardData, null, 2));
  console.error(`\nWrote gitlab-commits.json`);

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
```

- [ ] **Step 17: Manual smoke test with real GitLab**

```bash
node scripts/fetch-gitlab-commits.js --date 3/11 > /tmp/gitlab-output.json 2>/tmp/gitlab-stderr.txt
cat /tmp/gitlab-stderr.txt
node -e "const d=require('/tmp/gitlab-output.json'); console.log('Commits:', d.gitlabCommits.length); console.log('Members:', Object.keys(d.summary))"
```

Expected: Non-zero commits, known member names in summary.

Also verify dashboard JSON was written:

```bash
node -e "const d=require('./gitlab-commits.json'); console.log('Dates:', Object.keys(d.commits)); console.log('Analysis dates:', Object.keys(d.analysis))"
```

- [ ] **Step 18: Run all tests**

```bash
npm test
```

Expected: All tests PASS (including existing data-schema tests).

- [ ] **Step 19: Commit**

```bash
git add scripts/fetch-gitlab-commits.js
git commit -m "feat: add main function, CLI, and gitlab-commits.json output"
```

---

### Task 3: Apps Script Changes

**Files:**
- Modify: `appscript/Code.gs`

- [ ] **Step 1: Update doPost() with guards**

Read `appscript/Code.gs`. Change `doPost()` from unconditional calls to guarded calls:

```javascript
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (data.rawData) writeRawData_(ss, data.rawData);
  if (data.issues) writeIssues_(ss, data.issues);
  if (data.leave) writeLeave_(ss, data.leave);
  if (data.dailyUpdates) writeDailyUpdates_(ss, data.dailyUpdates);
  if (data.gitlabCommits) writeGitlabCommits_(ss, data.gitlabCommits);
  if (data.commitAnalysis) writeCommitAnalysis_(ss, data.commitAnalysis);

  var result = { status: 'ok' };
  if (data.rawData) result.dates = Object.keys(data.rawData).length;
  if (data.gitlabCommits) result.commits = data.gitlabCommits.length;
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Add writeGitlabCommits_**

Add after `writeDailyUpdates_()`:

```javascript
function writeGitlabCommits_(ss, commits) {
  var sheet = ss.getSheetByName('GitLab Commits');
  if (!sheet) sheet = ss.insertSheet('GitLab Commits');

  // Read existing rows for deduplication by date|member|sha
  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][0]) + '|' + String(existing[i][1]) + '|' + String(existing[i][4]);
    existingKeys[key] = true;
  }

  // Add header if empty
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 5).setValues([['日期', '成員', 'Project', 'Commit Title', 'SHA']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var i = 0; i < commits.length; i++) {
    var c = commits[i];
    var key = String(c.date) + '|' + String(c.member) + '|' + String(c.sha);
    if (existingKeys[key]) continue;
    newRows.push([c.date, c.member, c.project, c.title, c.sha]);
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 5).setValues(newRows);
  }
}
```

- [ ] **Step 3: Add writeCommitAnalysis_**

```javascript
function writeCommitAnalysis_(ss, analysis) {
  var sheet = ss.getSheetByName('Commit Analysis');
  if (!sheet) sheet = ss.insertSheet('Commit Analysis');

  // Read existing rows for deduplication by date|member (overwrite mode)
  var existing = sheet.getDataRange().getValues();
  var existingKeyRows = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][0]) + '|' + String(existing[i][1]);
    existingKeyRows[key] = i + 1; // 1-based row number
  }

  // Add header if empty
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 6).setValues([['日期', '成員', 'Commits數', 'Daily Update工時', '狀態', '參與Projects']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var i = 0; i < analysis.length; i++) {
    var a = analysis[i];
    var key = String(a.date) + '|' + String(a.member);
    var row = [a.date, a.member, a.commitCount, a.dailyUpdateHours === null ? '' : a.dailyUpdateHours, a.status, a.projects];
    if (existingKeyRows[key]) {
      // Overwrite existing row
      sheet.getRange(existingKeyRows[key], 1, 1, 6).setValues([row]);
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 6).setValues(newRows);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add appscript/Code.gs
git commit -m "feat: add GitLab commits and analysis sheets to Apps Script"
```

---

## Chunk 2: Dashboard & Skills

### Task 4: Dashboard — Data Loading & Commits Tab

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add parallel fetch of gitlab-commits.json**

In the Dashboard component's `useEffect` (around line 245), add a parallel fetch:

```javascript
useEffect(() => {
  Promise.all([
    fetch("raw_data.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("gitlab-commits.json").then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([rawDataResp, commitResp]) => {
    setRawData(rawDataResp.rawData);
    setIssues(rawDataResp.issues || []);
    setLeave(rawDataResp.leave || {});
    setCommitData(commitResp);
    setLoading(false);
  }).catch(err => {
    setError(err.message);
    setLoading(false);
  });
}, []);
```

Add state: `const [commitData, setCommitData] = useState(null);`

- [ ] **Step 2: Add teal color to COLORS**

```javascript
const COLORS = {
  // ... existing colors ...
  teal: "#06b6d4", tealDim: "#164e63",
};
```

- [ ] **Step 3: Add Commits tab to tab bar**

Update the tabs array (around line 522):

```javascript
{ key: "daily", label: "📊 每日工時" },
{ key: "trend", label: "📈 趨勢比較" },
{ key: "weekly", label: "📋 週統計" },
...(commitData ? [{ key: "commits", label: "🔀 Commits" }] : []),
```

- [ ] **Step 4: Implement CommitsView component**

Add a new component before the Dashboard component. This renders three sections: consistency grid, project participation chart, and commit detail table. **Use JSX syntax** (consistent with the rest of the codebase — Babel Standalone transpiles it).

The code below uses `React.createElement` for plan readability, but the implementer MUST convert to JSX when writing to `index.html`. Example: `React.createElement("div", { style: {...} }, "text")` → `<div style={{...}}>text</div>`.

```jsx
function CommitsView({ commitData, dates, members, memberColors, leave }) {
  const { commits, analysis, projectRisks } = commitData;
  const [expandedMember, setExpandedMember] = useState(null);

  // Consistency Grid
  const gridDates = dates.filter(d => analysis[d]);

  // Project data for stacked bar
  const projectSet = new Set();
  const memberProjectCounts = {};
  for (const [date, memberCommits] of Object.entries(commits)) {
    for (const [member, data] of Object.entries(memberCommits)) {
      if (!memberProjectCounts[member]) memberProjectCounts[member] = {};
      for (const item of data.items) {
        projectSet.add(item.project);
        memberProjectCounts[member][item.project] = (memberProjectCounts[member][item.project] || 0) + 1;
      }
    }
  }
  const allProjects = [...projectSet].sort();
  const projectColors = {};
  const projectPalette = ["#06b6d4","#22c55e","#f59e0b","#ef4444","#a78bfa","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16"];
  allProjects.forEach((p, i) => { projectColors[p] = projectPalette[i % projectPalette.length]; });

  const barData = Object.entries(memberProjectCounts)
    .map(([member, projects]) => ({ member, ...projects, _total: Object.values(projects).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b._total - a._total);

  // Commit detail per member
  const memberCommitList = {};
  for (const [date, mc] of Object.entries(commits)) {
    for (const [member, data] of Object.entries(mc)) {
      if (!memberCommitList[member]) memberCommitList[member] = [];
      for (const item of data.items) {
        memberCommitList[member].push({ date, ...item });
      }
    }
  }

  const statusColor = s => s === '✅' ? COLORS.green : s === '⚠️' ? COLORS.yellow : s === '🔴' ? COLORS.red : COLORS.textDim;
  const statusBg = s => s === '✅' ? COLORS.greenDim : s === '⚠️' ? COLORS.yellowDim : s === '🔴' ? COLORS.redDim : COLORS.border;

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 24 } },
    // Consistency Grid
    React.createElement(CardPanel, { title: "一致性檢查" },
      React.createElement("div", { style: { overflowX: "auto" } },
        React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 } },
          React.createElement("thead", null,
            React.createElement("tr", null,
              React.createElement("th", { style: { padding: "6px 12px", textAlign: "left", color: COLORS.textMuted, fontWeight: 400 } }, "成員"),
              ...gridDates.map(d => React.createElement("th", { key: d, style: { padding: "6px 8px", textAlign: "center", color: COLORS.textMuted, fontWeight: 400, fontSize: 11 } }, d))
            )
          ),
          React.createElement("tbody", null,
            ...members.filter(m => gridDates.some(d => analysis[d]?.[m])).map(m =>
              React.createElement("tr", { key: m },
                React.createElement("td", { style: { padding: "6px 12px", color: COLORS.text } }, m),
                ...gridDates.map(d => {
                  const a = analysis[d]?.[m];
                  const onLeaveDay = leave[m] && leave[m].some(r => {
                    const dn = d.split('/').map(Number);
                    const sn = r.start.split('/').map(Number);
                    const en = r.end.split('/').map(Number);
                    return (dn[0]*100+dn[1]) >= (sn[0]*100+sn[1]) && (dn[0]*100+dn[1]) <= (en[0]*100+en[1]);
                  });
                  const bg = a ? statusBg(a.status) : (onLeaveDay ? COLORS.orangeDim : "transparent");
                  const color = a ? statusColor(a.status) : (onLeaveDay ? COLORS.orange : COLORS.textDim);
                  const label = a ? a.status : (onLeaveDay ? "假" : "·");
                  return React.createElement("td", { key: d, style: { padding: "4px 8px", textAlign: "center" } },
                    React.createElement("span", { style: { display: "inline-block", width: 28, height: 28, lineHeight: "28px", borderRadius: 6, background: bg, color, fontSize: 14 } }, label)
                  );
                })
              )
            )
          )
        )
      )
    ),

    // Project Participation
    allProjects.length > 0 && React.createElement(CardPanel, { title: "專案參與度" },
      React.createElement(ResponsiveContainer, { width: "100%", height: barData.length * 36 + 40 },
        React.createElement(BarChart, { data: barData, layout: "vertical", margin: { left: 60, right: 20 } },
          React.createElement(CartesianGrid, { strokeDasharray: "3 3", stroke: COLORS.border }),
          React.createElement(XAxis, { type: "number" }),
          React.createElement(YAxis, { type: "category", dataKey: "member", width: 50, tick: { fill: COLORS.textMuted, fontSize: 12 } }),
          React.createElement(Tooltip, { contentStyle: { background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text } }),
          ...allProjects.map(p =>
            React.createElement(Bar, { key: p, dataKey: p, stackId: "a", fill: projectColors[p], name: p.split('/').pop() })
          )
        )
      ),
      projectRisks.length > 0 && React.createElement("div", { style: { marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 } },
        ...projectRisks.map(r =>
          React.createElement("span", { key: r.project, style: { padding: "4px 10px", borderRadius: 6, fontSize: 12, background: COLORS.yellowDim, color: COLORS.yellow } },
            `⚠️ ${r.project.split('/').pop()} — 僅 ${r.soloContributor} 貢獻`
          )
        )
      )
    ),

    // Commit Detail
    React.createElement(CardPanel, { title: "Commit 明細" },
      ...Object.entries(memberCommitList).sort((a,b) => b[1].length - a[1].length).map(([member, items]) =>
        React.createElement("div", { key: member, style: { marginBottom: 8 } },
          React.createElement("button", {
            onClick: () => setExpandedMember(expandedMember === member ? null : member),
            style: { width: "100%", textAlign: "left", background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 12px", color: COLORS.text, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }
          },
            React.createElement("span", null, `${member}`),
            React.createElement("span", { style: { color: COLORS.teal } }, `${items.length} commits ${expandedMember === member ? '▲' : '▼'}`)
          ),
          expandedMember === member && React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 } },
            React.createElement("tbody", null,
              ...items.sort((a,b) => b.date.localeCompare(a.date)).map((item, i) =>
                React.createElement("tr", { key: i, style: { borderBottom: `1px solid ${COLORS.border}` } },
                  React.createElement("td", { style: { padding: "4px 8px", color: COLORS.textMuted, width: 40 } }, item.date),
                  React.createElement("td", { style: { padding: "4px 8px", color: COLORS.teal, width: 120, fontSize: 11 } }, item.project.split('/').pop()),
                  React.createElement("td", { style: { padding: "4px 8px", color: COLORS.text } }, item.title),
                  React.createElement("td", { style: { padding: "4px 8px", color: COLORS.textDim, width: 70, fontFamily: "JetBrains Mono, SF Mono, monospace", fontSize: 11 } }, item.sha)
                )
              )
            )
          )
        )
      )
    )
  );
}
```

- [ ] **Step 5: Add CommitsView rendering in the view switch**

After the weekly view block (around line 900), add:

```jsx
{view === "commits" && commitData && (
  <CommitsView commitData={commitData} dates={dates} members={members} memberColors={memberColors} leave={leave} />
)}
```

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Commits tab with consistency grid, project participation, and detail table"
```

---

### Task 5: Dashboard — Daily View Badges & Trend Overlay

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add commit badge to member cards**

In the Daily view member card rendering (around line 580), add commit count badge and consistency indicator. Find the member card header section and add:

After the StatusBadge in each member card, add:

```jsx
{/* Commit badge — top right of card */}
{commitData && commitData.commits[activeDate]?.[name]?.count > 0 && (
  <span style={{ position: "absolute", top: 8, right: 8, background: COLORS.tealDim, color: COLORS.teal, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
    {commitData.commits[activeDate][name].count} commits
  </span>
)}
{/* Consistency indicator */}
{commitData?.analysis?.[activeDate]?.[name] && (
  <span style={{ marginLeft: 6, fontSize: 12 }}>
    {commitData.analysis[activeDate][name].status}
  </span>
)}
```

The member card container needs `position: "relative"` added to its style.

- [ ] **Step 2: Add commit bars to trend chart**

In the Trend view ComposedChart (around line 674), add a secondary Y-axis and commit bars:

Add `yAxisId="left"` to ALL existing chart children that reference the Y axis: the existing `YAxis`, the `Area` element (min-max range), the team average `Line`, all individual member `Line` elements, and both `ReferenceLine` elements. This is required — Recharts will error if any child lacks `yAxisId` when multiple Y axes are present.

Add a new right Y-axis:

```jsx
{commitData && <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textDim, fontSize: 11 }} label={{ value: "commits", angle: 90, position: "insideRight", fill: COLORS.textDim }} />}
```

Add commit count bars for selected members:

```jsx
{commitData && selectedMembers.size > 0 && [...selectedMembers].map(m =>
  <Bar key={`commit-${m}`} yAxisId="right" dataKey={`_commit_${m}`} fill={memberColors[m]} fillOpacity={0.25} />
)}
```

Update `trendData` useMemo to include commit counts from `commitData`:

```javascript
// Inside trendData computation, for each date row:
if (commitData?.commits?.[d]) {
  for (const m of members) {
    row[`_commit_${m}`] = commitData.commits[d]?.[m]?.count || 0;
  }
}
```

- [ ] **Step 3: Integrate commit warnings into issues ticker**

In the Status Overview section (around line 477), merge `projectRisks` from `commitData` into the attention cards list:

```javascript
const allIssues = useMemo(() => {
  const base = issues.filter(i => i.severity !== '🟢');
  if (!commitData) return base;
  // Add project risks
  for (const r of (commitData.projectRisks || [])) {
    base.push({ member: r.soloContributor, severity: r.severity, text: `${r.project.split('/').pop()} 單點貢獻` });
  }
  // Add 🔴 consistency issues for active date
  const activeAnalysis = commitData.analysis?.[activeDate] || {};
  for (const [m, a] of Object.entries(activeAnalysis)) {
    if (a.status === '🔴') {
      base.push({ member: m, severity: '🔴', text: `有 ${a.commitCount} commits 但未回報工時` });
    }
  }
  return base;
}, [issues, commitData, activeDate]);
```

Replace the existing `issues.filter(i => i.severity !== '🟢')` in the attention cards section with `allIssues`.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 5: Manual visual test**

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Verify:
1. Commits tab appears (if `gitlab-commits.json` exists)
2. Daily view shows commit badges on cards
3. Trend view shows commit bars when members selected
4. Issues ticker shows commit warnings

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add commit badges to daily view, trend overlay, and issues integration"
```

---

### Task 6: Skills

**Files:**
- Create: `.claude/skills/sync-gitlab-commits.md`
- Create: `.claude/skills/sync.md`

- [ ] **Step 1: Create sync-gitlab-commits skill**

```markdown
# Sync GitLab Commits

Fetch GitLab commits for the engineering team and update Google Spreadsheet.

## Prerequisites

- `gitlab-config.json` exists with `baseUrl`, `token`, `memberMap`, `excludeAuthors`
- `raw_data.json` exists with current data

## Workflow

### Step 1: Read config

Read `gitlab-config.json` to confirm settings exist.

### Step 2: Determine date

If no date argument provided, use previous work day.
User can specify: `/sync-gitlab-commits 3/11` or `/sync-gitlab-commits 3/9-3/12`

### Step 3: Fetch and analyze

```bash
node scripts/fetch-gitlab-commits.js --date <date> > /tmp/gitlab-commits-output.json 2>/tmp/gitlab-commits-stderr.txt
```

Review stderr for progress and warnings.

### Step 4: Review output

```bash
node -e "const d=require('/tmp/gitlab-commits-output.json'); console.log('Commits:', d.gitlabCommits.length, 'Members:', Object.keys(d.summary).length)"
```

### Step 5: POST to Google Sheets

```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @/tmp/gitlab-commits-output.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)

curl -s "$REDIRECT_URL"
```

Expected: `{"status":"ok","commits":N}`

### Step 6: Commit gitlab-commits.json

```bash
git add gitlab-commits.json
git commit -m "Update GitLab commits data for <date>"
git push
```

### Step 7: Output summary

```
✅ GitLab Commits Sync 完成
日期：<date>
Commits：<N>
成員：<member list with counts>
一致性：✅ <n> ⚠️ <n> 🔴 <n>
```
```

- [ ] **Step 2: Create unified sync skill**

```markdown
# Sync All

Run daily update sync and GitLab commits sync together.

## Workflow

### Step 1: Run both syncs in parallel

Execute `/sync-daily-updates` and `/sync-gitlab-commits` using the Agent tool:
- One as foreground agent
- One as background agent with `run_in_background: true`

### Step 2: Wait for both to complete

Monitor progress messages from both agents.

### Step 3: Combined summary

After both complete, display a unified summary:

```
✅ Sync All 完成

Daily Updates:
  新增日期：<dates>
  回報率：<N>/<M>

GitLab Commits:
  Commits：<N>
  一致性：✅ <n> ⚠️ <n> 🔴 <n>

成員總覽：
  成員    | Commits | 工時  | 狀態
  Joyce  | 11      | 10.5  | ✅
  Ted    | 8       | 7.5   | ✅
  ...
```
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sync-gitlab-commits.md .claude/skills/sync.md
git commit -m "feat: add sync-gitlab-commits and unified sync skills"
```

---

### Task 7: Final Integration Test

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 2: End-to-end smoke test**

```bash
# Fetch commits for 3/11
node scripts/fetch-gitlab-commits.js --date 3/11 > /tmp/gitlab-output.json

# Verify gitlab-commits.json written
node -e "const d=require('./gitlab-commits.json'); console.log(JSON.stringify({dates: Object.keys(d.commits), analysisStatus: Object.values(d.analysis).flatMap(d=>Object.values(d)).map(a=>a.status)}, null, 2))"

# Serve and visually check dashboard
python3 -m http.server 8000
```

Open `http://localhost:8000`. Verify all four tabs work, commit badges appear on daily view, and consistency grid renders correctly.

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git status
# If changes: git add <files> && git commit -m "chore: final cleanup for gitlab commits integration"
```
