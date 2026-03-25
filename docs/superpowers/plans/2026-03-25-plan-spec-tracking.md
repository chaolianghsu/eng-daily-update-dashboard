# Plan/Spec File Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect plan/spec documentation files in GitLab/GitHub commits, cross-reference with daily updates, and surface correlation insights in the dashboard.

**Architecture:** Two new Node.js scripts handle detection and prompt generation (Stage 4 of /sync pipeline). Frontend adds a badge to CommitsView and a new PlanSpecView tab. Apps Script handler writes to two new sheets.

**Tech Stack:** Node.js (scripts), React 18 + TypeScript (frontend), Vitest (tests), Playwright (E2E), Google Apps Script (Sheets)

**Spec:** `docs/superpowers/specs/2026-03-25-plan-spec-tracking-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `scripts/detect-plan-specs.js` | Keyword filter commits → fetch file changes from API → output spec candidates |
| `scripts/prepare-plan-analysis.js` | Build Claude CLI prompt from spec candidates + daily updates |
| `src/PlanSpecView.tsx` | New dashboard tab: correlation grid + detail list |
| `tests/detect-plan-specs.test.js` | Unit tests for detection script |
| `tests/prepare-plan-analysis.test.js` | Unit tests for prompt generation script |
| `tests/plan-analysis-schema.test.js` | Schema validation for plan-analysis.json |
| `tests/PlanSpecView.test.tsx` | Component tests for PlanSpecView |

### Modified Files
| File | Change |
|------|--------|
| `src/types.ts` | Add `PlanSpecItem`, `PlanCorrelation`, `PlanAnalysisData` types |
| `src/main.tsx` | Fetch `plan-analysis.json` in `loadData()` |
| `src/App.tsx` | Add `planAnalysisData` state, "規劃追蹤" tab, route to PlanSpecView |
| `src/CommitsView.tsx` | Add 📋 badge for spec commits |
| `appscript/Code.gs` | Add `writePlanAnalysis_()` handler in `doPost()` |
| `.claude/skills/sync.md` | Add Stage 4 to pipeline |
| `CLAUDE.md` | Document new scripts, schema, Stage 4 |

---

### Task 1: Types — PlanAnalysisData

**Files:**
- Modify: `src/types.ts`
- Test: `tests/plan-analysis-schema.test.js` (create)

- [ ] **Step 1: Write schema validation test**

```javascript
// tests/plan-analysis-schema.test.js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('plan-analysis.json schema', () => {
  const filePath = path.join(__dirname, '../public/plan-analysis.json');
  const fileExists = fs.existsSync(filePath);

  it.skipIf(!fileExists)('has valid top-level structure', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data).toHaveProperty('analysisDate');
    expect(data).toHaveProperty('period');
    expect(data).toHaveProperty('planSpecs');
    expect(data).toHaveProperty('summary');
    expect(Array.isArray(data.planSpecs)).toBe(true);
  });

  it.skipIf(!fileExists)('planSpecs items have required fields', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const item of data.planSpecs) {
      expect(item).toHaveProperty('date');
      expect(item).toHaveProperty('member');
      expect(item).toHaveProperty('commit');
      expect(item.commit).toHaveProperty('title');
      expect(item.commit).toHaveProperty('sha');
      expect(item.commit).toHaveProperty('project');
      expect(Array.isArray(item.files)).toBe(true);
    }
  });

  it.skipIf(!fileExists)('correlations have valid status', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.correlations) return;
    const validStatuses = ['matched', 'unmatched', 'partial'];
    for (const c of data.correlations) {
      expect(validStatuses).toContain(c.status);
      expect(typeof c.specCommits).toBe('number');
    }
  });

  it.skipIf(!fileExists)('summary counts are consistent', () => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const s = data.summary;
    expect(s.matched + s.unmatched + s.partial).toBe(s.totalCorrelations);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or skips**

Run: `bun run test tests/plan-analysis-schema.test.js`
Expected: All tests skip (file doesn't exist yet) — this confirms test structure is valid.

- [ ] **Step 3: Add types to src/types.ts**

Add after `TaskAnalysisData` (around line 68):

```typescript
export interface PlanSpecItem {
  date: string;
  member: string;
  commit: {
    title: string;
    sha: string;
    project: string;
    url: string;
    source: 'gitlab' | 'github';
  };
  files: string[];
}

export interface PlanCorrelation {
  date: string;
  member: string;
  status: 'matched' | 'unmatched' | 'partial';
  specCommits: number;
  dailyUpdateMention: boolean;
  matchedTasks: string[];
  unmatchedSpecs: string[];
  reasoning: string;
}

export interface PlanAnalysisData {
  analysisDate: string;
  period: string;
  planSpecs: PlanSpecItem[];
  correlations?: PlanCorrelation[];
  summary: {
    totalSpecCommits: number;
    totalCorrelations: number;
    membersWithSpecs: number;
    matched: number;
    unmatched: number;
    partial: number;
  };
}
```

- [ ] **Step 4: Update DashboardData type**

In `src/types.ts`, add to `DashboardData` interface:

```typescript
planAnalysisData: PlanAnalysisData | null;
```

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: All existing tests pass. Schema tests skip.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts tests/plan-analysis-schema.test.js
git commit -m "feat: add PlanAnalysisData types and schema validation tests"
```

---

### Task 2: detect-plan-specs.js — Keyword Matching

**Files:**
- Create: `scripts/detect-plan-specs.js`
- Test: `tests/detect-plan-specs.test.js` (create)

- [ ] **Step 1: Write keyword matching test**

```javascript
// tests/detect-plan-specs.test.js
import { describe, it, expect } from 'vitest';
import { matchesSpecKeyword } from '../scripts/detect-plan-specs.js';

describe('matchesSpecKeyword', () => {
  it('matches English keywords in commit title', () => {
    expect(matchesSpecKeyword('docs: add API design spec')).toBe(true);
    expect(matchesSpecKeyword('feat: update plan document')).toBe(true);
    expect(matchesSpecKeyword('docs: RFC for auth flow')).toBe(true);
    expect(matchesSpecKeyword('refactor: update architecture')).toBe(true);
  });

  it('matches Chinese keywords', () => {
    expect(matchesSpecKeyword('新增 API 設計文件')).toBe(true);
    expect(matchesSpecKeyword('更新架構規劃')).toBe(true);
  });

  it('rejects non-spec commits', () => {
    expect(matchesSpecKeyword('fix: resolve login bug')).toBe(false);
    expect(matchesSpecKeyword('feat: add user profile page')).toBe(false);
    expect(matchesSpecKeyword('chore: update dependencies')).toBe(false);
  });

  it('excludes false positives', () => {
    expect(matchesSpecKeyword('fix: docker compose config')).toBe(false);
    expect(matchesSpecKeyword('chore: archive old logs')).toBe(false);
    expect(matchesSpecKeyword('feat: update Dockerfile')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/detect-plan-specs.test.js`
Expected: FAIL — `matchesSpecKeyword` not defined

- [ ] **Step 3: Implement matchesSpecKeyword**

```javascript
// scripts/detect-plan-specs.js

const SPEC_KEYWORDS_EN = /\b(plan|spec|design|docs?|rfc|proposal|architecture)\b/i;
const SPEC_KEYWORDS_ZH = /規劃|設計|架構|文件/;
const FALSE_POSITIVE_EN = /\b(docker|dockerfile|archive|archived)\b/i;

function matchesSpecKeyword(title) {
  if (FALSE_POSITIVE_EN.test(title)) return false;
  return SPEC_KEYWORDS_EN.test(title) || SPEC_KEYWORDS_ZH.test(title);
}

export { matchesSpecKeyword };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/detect-plan-specs.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/detect-plan-specs.js tests/detect-plan-specs.test.js
git commit -m "feat: add keyword matching for plan/spec commit detection"
```

---

### Task 3: detect-plan-specs.js — File Path Filtering

**Files:**
- Modify: `scripts/detect-plan-specs.js`
- Modify: `tests/detect-plan-specs.test.js`

- [ ] **Step 1: Write file path filtering test**

```javascript
import { isDocFile } from '../scripts/detect-plan-specs.js';

describe('isDocFile', () => {
  it('matches docs directory markdown files', () => {
    expect(isDocFile('docs/specs/api-design.md')).toBe(true);
    expect(isDocFile('docs/plans/migration-plan.md')).toBe(true);
    expect(isDocFile('project/design/arch.md')).toBe(true);
  });

  it('matches root-level spec files', () => {
    expect(isDocFile('SPEC.md')).toBe(true);
    expect(isDocFile('PLAN.md')).toBe(true);
    expect(isDocFile('DESIGN.md')).toBe(true);
    expect(isDocFile('RFC-auth-flow.md')).toBe(true);
  });

  it('rejects non-doc files', () => {
    expect(isDocFile('src/utils.ts')).toBe(false);
    expect(isDocFile('docs/specs/data.json')).toBe(false);
    expect(isDocFile('README.md')).toBe(false);
    expect(isDocFile('CHANGELOG.md')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/detect-plan-specs.test.js`
Expected: FAIL — `isDocFile` not defined

- [ ] **Step 3: Implement isDocFile**

Add to `scripts/detect-plan-specs.js`:

```javascript
const DOC_DIRS = /(?:^|\/)(?:docs?|specs?|plans?|design)\//i;
const ROOT_SPEC_FILES = /^(?:SPEC|PLAN|DESIGN|RFC-[^/]+)\.md$/i;

function isDocFile(filePath) {
  if (!filePath.endsWith('.md')) return false;
  return DOC_DIRS.test(filePath) || ROOT_SPEC_FILES.test(filePath);
}

export { matchesSpecKeyword, isDocFile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/detect-plan-specs.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/detect-plan-specs.js tests/detect-plan-specs.test.js
git commit -m "feat: add file path filtering for doc/spec files"
```

---

### Task 4: detect-plan-specs.js — API Fetching & CLI

**Files:**
- Modify: `scripts/detect-plan-specs.js`
- Modify: `tests/detect-plan-specs.test.js`

- [ ] **Step 1: Write test for filterSpecCommits (integration of keyword + file filtering)**

```javascript
import { filterSpecCommits } from '../scripts/detect-plan-specs.js';

describe('filterSpecCommits', () => {
  it('filters commits by keyword and returns candidates', () => {
    const commits = {
      '哲緯': {
        count: 3,
        projects: ['bigdata/api'],
        items: [
          { title: 'docs: add API design', sha: 'abc12345', project: 'bigdata/api', url: 'https://example.com/abc12345', source: 'gitlab' },
          { title: 'fix: login bug', sha: 'def67890', project: 'bigdata/api', url: 'https://example.com/def67890', source: 'gitlab' },
        ]
      }
    };
    const candidates = filterSpecCommits(commits);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].commit.title).toBe('docs: add API design');
    expect(candidates[0].member).toBe('哲緯');
  });

  it('returns empty array when no keywords match', () => {
    const commits = {
      'Ted': {
        count: 1,
        projects: ['sinyi/app'],
        items: [
          { title: 'fix: button alignment', sha: 'aaa11111', project: 'sinyi/app', url: 'https://example.com/aaa', source: 'gitlab' },
        ]
      }
    };
    expect(filterSpecCommits(commits)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/detect-plan-specs.test.js`
Expected: FAIL — `filterSpecCommits` not defined

- [ ] **Step 3: Implement filterSpecCommits**

Add to `scripts/detect-plan-specs.js`:

```javascript
function filterSpecCommits(dateCommits) {
  const candidates = [];
  for (const [member, data] of Object.entries(dateCommits)) {
    for (const item of data.items || []) {
      if (matchesSpecKeyword(item.title)) {
        candidates.push({
          member,
          commit: {
            title: item.title,
            sha: item.sha,
            project: item.project,
            url: item.url,
            source: item.source || 'gitlab',
          },
          files: [], // populated later by API
        });
      }
    }
  }
  return candidates;
}

export { matchesSpecKeyword, isDocFile, filterSpecCommits };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/detect-plan-specs.test.js`
Expected: PASS

- [ ] **Step 5: Implement fetchFilesForCandidates and CLI main**

Add API fetching logic and CLI entry point to `scripts/detect-plan-specs.js`:

```javascript
import https from 'https';
import fs from 'fs';
import path from 'path';

// fetchJSON — reuse pattern from fetch-gitlab-commits.js
// fetchGitLabDiff(projectPath, sha, token) → file paths array
// fetchGitHubFiles(project, sha, token) → file paths array
// Main CLI: read configs, read gitlab-commits.json, filter, fetch, output JSON

async function fetchGitLabDiff(projectPath, sha, config) {
  const encoded = encodeURIComponent(projectPath);
  const url = `${config.baseUrl}/api/v4/projects/${encoded}/repository/commits/${sha}/diff`;
  // ... fetch and extract new_path from each diff entry
  return diffPaths;
}

async function fetchGitHubFiles(project, sha, commitUrl, config) {
  // Extract full SHA from commitUrl if needed: /commit/<full_sha>
  const fullSha = commitUrl ? commitUrl.split('/commit/').pop() : sha;
  const [owner, repo] = project.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${fullSha}`;
  // ... fetch and extract filename from files array
  return filePaths;
}

async function main() {
  const dateArg = process.argv.find((a, i) => process.argv[i - 1] === '--date');
  if (!dateArg) { console.error('Usage: --date M/D'); process.exit(1); }

  const commitsData = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'public/gitlab-commits.json'), 'utf8'
  ));

  const dateCommits = commitsData.commits?.[dateArg];
  if (!dateCommits) {
    process.stdout.write('[]');
    process.exit(0);
  }

  const candidates = filterSpecCommits(dateCommits);
  if (candidates.length === 0) {
    process.stdout.write('[]');
    process.exit(0);
  }

  // Load configs
  const gitlabConfig = JSON.parse(fs.readFileSync('gitlab-config.json', 'utf8'));
  let githubConfig = null;
  try { githubConfig = JSON.parse(fs.readFileSync('github-config.json', 'utf8')); } catch {}

  // Fetch file changes (max 50 API calls)
  let apiCalls = 0;
  for (const c of candidates) {
    if (apiCalls >= 50) break;
    try {
      const files = c.commit.source === 'github' && githubConfig
        ? await fetchGitHubFiles(c.commit.project, c.commit.sha, c.commit.url, githubConfig)
        : await fetchGitLabDiff(c.commit.project, c.commit.sha, gitlabConfig);
      c.files = files.filter(isDocFile);
      apiCalls++;
    } catch (e) {
      console.error(`Warning: failed to fetch files for ${c.commit.sha}: ${e.message}`);
    }
  }

  // Output only candidates with doc files
  const results = candidates
    .filter(c => c.files.length > 0)
    .map(c => ({ date: dateArg, ...c }));

  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Run all tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add scripts/detect-plan-specs.js tests/detect-plan-specs.test.js
git commit -m "feat: add API file fetching and CLI for detect-plan-specs"
```

---

### Task 5: prepare-plan-analysis.js — Prompt Generation

**Files:**
- Create: `scripts/prepare-plan-analysis.js`
- Create: `tests/prepare-plan-analysis.test.js`

- [ ] **Step 1: Write test for buildPrompt**

```javascript
// tests/prepare-plan-analysis.test.js
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../scripts/prepare-plan-analysis.js';

describe('buildPrompt', () => {
  it('generates prompt with spec commits and daily updates', () => {
    const specs = [
      {
        date: '3/24',
        member: '哲緯',
        commit: { title: 'docs: API design', sha: 'abc123', project: 'bigdata/api', url: '', source: 'gitlab' },
        files: ['docs/specs/api.md']
      }
    ];
    const dailyUpdates = [
      { date: '3/24', member: '哲緯', text: '1. API 設計文件撰寫 (2H)' }
    ];

    const prompt = buildPrompt(specs, dailyUpdates, '3/24');
    expect(prompt).toContain('哲緯');
    expect(prompt).toContain('docs/specs/api.md');
    expect(prompt).toContain('API 設計文件撰寫');
    expect(prompt).toContain('"status"');
    expect(prompt).toContain('matched');
  });

  it('handles empty daily updates gracefully', () => {
    const specs = [
      {
        date: '3/24',
        member: 'Ted',
        commit: { title: 'docs: add spec', sha: 'def456', project: 'sinyi/app', url: '', source: 'gitlab' },
        files: ['docs/specs/feature.md']
      }
    ];

    const prompt = buildPrompt(specs, [], '3/24');
    expect(prompt).toContain('Ted');
    expect(prompt).toContain('無 daily update');
  });

  it('returns null when no specs', () => {
    expect(buildPrompt([], [], '3/24')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/prepare-plan-analysis.test.js`
Expected: FAIL — `buildPrompt` not defined

- [ ] **Step 3: Implement prepare-plan-analysis.js**

```javascript
// scripts/prepare-plan-analysis.js
import fs from 'fs';
import path from 'path';

function buildPrompt(specs, dailyUpdates, dateArg) {
  if (!specs || specs.length === 0) return null;

  // Group specs by member
  const specsByMember = {};
  for (const s of specs) {
    if (!specsByMember[s.member]) specsByMember[s.member] = [];
    specsByMember[s.member].push(s);
  }

  // Group daily updates by member
  const updatesByMember = {};
  for (const u of dailyUpdates) {
    if (u.date === dateArg) updatesByMember[u.member] = u.text;
  }

  // Build per-member blocks
  const blocks = Object.entries(specsByMember).map(([member, memberSpecs]) => {
    const specLines = memberSpecs.map(s =>
      `  - ${s.commit.title} (${s.commit.project})\n    檔案: ${s.files.join(', ')}`
    ).join('\n');

    const updateText = updatesByMember[member] || '（無 daily update）';

    return `### ${member}\n\n**Spec commits (${memberSpecs.length}):**\n${specLines}\n\n**Daily update:**\n${updateText}`;
  }).join('\n\n---\n\n');

  const prompt = `你是工程團隊分析助手。以下是 ${dateArg} 的 spec/plan 文件 commits 和 daily updates。

請分析每位成員的 spec commits 是否在 daily update 中有對應的工作項目描述。

## 分類規則

- **matched**: daily update 有提到對應的 spec/plan 工作
- **unmatched**: 有 spec commit 但 daily update 完全沒提到
- **partial**: daily update 有提到但描述不完整

## 成員資料

${blocks}

## 輸出格式

請直接輸出 JSON（不要 markdown fence）：

{
  "analysisDate": "${new Date().toISOString().split('T')[0]}",
  "period": "${dateArg}",
  "planSpecs": ${JSON.stringify(specs)},
  "correlations": [
    {
      "date": "${dateArg}",
      "member": "成員名",
      "status": "matched|unmatched|partial",
      "specCommits": 數量,
      "dailyUpdateMention": true/false,
      "matchedTasks": ["對應的工作項目"],
      "unmatchedSpecs": ["未對應的 spec 檔案"],
      "reasoning": "分析理由"
    }
  ],
  "summary": {
    "totalSpecCommits": 總數,
    "totalCorrelations": 成員數,
    "membersWithSpecs": 成員數,
    "matched": 數量,
    "unmatched": 數量,
    "partial": 數量
  }
}`;

  return prompt;
}

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const specsIdx = args.indexOf('--specs');

  if (dateIdx === -1 || specsIdx === -1) {
    console.error('Usage: --date M/D --specs <path>');
    process.exit(1);
  }

  const dateArg = args[dateIdx + 1];
  const specsPath = args[specsIdx + 1];

  const specs = JSON.parse(fs.readFileSync(specsPath, 'utf8'));

  // Read dailyUpdates from raw_data.json
  let dailyUpdates = [];
  try {
    const rawData = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'public/raw_data.json'), 'utf8'
    ));
    dailyUpdates = rawData.dailyUpdates || [];
  } catch {}

  const prompt = buildPrompt(specs, dailyUpdates, dateArg);
  if (!prompt) {
    // No specs — output empty result directly
    const empty = {
      analysisDate: new Date().toISOString().split('T')[0],
      period: dateArg,
      planSpecs: [],
      correlations: [],
      summary: { totalSpecCommits: 0, totalCorrelations: 0, membersWithSpecs: 0, matched: 0, unmatched: 0, partial: 0 }
    };
    process.stdout.write(JSON.stringify(empty, null, 2));
    process.exit(0);
  }

  process.stdout.write(prompt);
}

main().catch(e => { console.error(e); process.exit(1); });

export { buildPrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/prepare-plan-analysis.test.js`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add scripts/prepare-plan-analysis.js tests/prepare-plan-analysis.test.js
git commit -m "feat: add prompt generation for plan/spec analysis"
```

---

### Task 6: Frontend — Data Loading

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update main.tsx to fetch plan-analysis.json**

In `src/main.tsx`, add `plan-analysis.json` to the `Promise.all()`:

```typescript
const [raw, commits, tasks, planAnalysis] = await Promise.all([
  fetch("raw_data.json").then(r => { if (!r.ok) throw new Error(); return r.json(); }),
  fetch("gitlab-commits.json").then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("task-analysis.json").then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("plan-analysis.json").then(r => r.ok ? r.json() : null).catch(() => null),
]);
```

Return `planAnalysisData: planAnalysis` in the return object.

- [ ] **Step 2: Update App.tsx state and loading**

Add state:
```typescript
const [planAnalysisData, setPlanAnalysisData] = useState<PlanAnalysisData | null>(null);
```

In the `useEffect` loadData callback, add:
```typescript
setPlanAnalysisData(data.planAnalysisData);
```

- [ ] **Step 3: Add "規劃追蹤" tab button**

In the tab bar (around line 131), after the Commits tab:
```typescript
{planAnalysisData && planAnalysisData.planSpecs.length > 0 && (
  <button onClick={() => setView("planspec")} style={/* tab style */}>
    📋 規劃追蹤
  </button>
)}
```

- [ ] **Step 4: Add PlanSpecView route**

In the view routing section (around line 155), add:
```typescript
{view === "planspec" && planAnalysisData && (
  <PlanSpecView
    planAnalysisData={planAnalysisData}
    members={members}
    memberColors={memberColors}
    dates={dates}
    activeDate={activeDate}
    onDateSelect={setActiveDate}
  />
)}
```

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: All tests pass (PlanSpecView doesn't exist yet but route is conditional)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/main.tsx src/App.tsx
git commit -m "feat: add plan analysis data loading and tab routing"
```

---

### Task 7: CommitsView Badge

**Files:**
- Modify: `src/CommitsView.tsx`
- Test: `tests/CommitsView-badge.test.tsx` (create)

- [ ] **Step 1: Write test for badge rendering**

```typescript
// tests/CommitsView-badge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasSpecFile } from '../src/CommitsView';

describe('hasSpecFile', () => {
  it('returns true when commit sha matches planSpecs', () => {
    const planSpecs = [
      { date: '3/24', member: '哲緯', commit: { sha: 'abc12345' }, files: ['docs/spec.md'] }
    ];
    expect(hasSpecFile('abc12345', planSpecs)).toBe(true);
  });

  it('returns false for non-matching sha', () => {
    const planSpecs = [
      { date: '3/24', member: '哲緯', commit: { sha: 'abc12345' }, files: ['docs/spec.md'] }
    ];
    expect(hasSpecFile('zzz99999', planSpecs)).toBe(false);
  });

  it('returns false when planSpecs is null', () => {
    expect(hasSpecFile('abc12345', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/CommitsView-badge.test.tsx`
Expected: FAIL — `hasSpecFile` not defined

- [ ] **Step 3: Implement hasSpecFile and badge in CommitsView**

Add to `src/CommitsView.tsx`:

```typescript
export function hasSpecFile(sha: string, planSpecs: PlanSpecItem[] | null): boolean {
  if (!planSpecs) return false;
  return planSpecs.some(s => s.commit.sha === sha);
}

function getSpecFiles(sha: string, planSpecs: PlanSpecItem[] | null): string[] {
  if (!planSpecs) return [];
  const match = planSpecs.find(s => s.commit.sha === sha);
  return match?.files || [];
}
```

Add `planSpecs` to CommitsViewProps:
```typescript
planSpecs: PlanSpecItem[] | null;
```

In the commit detail row, after the source icon, add:
```typescript
{hasSpecFile(item.sha, planSpecs) && (
  <span title={getSpecFiles(item.sha, planSpecs).join('\n')}
    style={{ cursor: 'help', marginLeft: 4 }}>📋</span>
)}
```

- [ ] **Step 4: Update App.tsx to pass planSpecs prop**

```typescript
planSpecs={planAnalysisData?.planSpecs || null}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test tests/CommitsView-badge.test.tsx`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/CommitsView.tsx src/App.tsx tests/CommitsView-badge.test.tsx
git commit -m "feat: add 📋 badge for spec commits in CommitsView"
```

---

### Task 8: PlanSpecView Component

**Files:**
- Create: `src/PlanSpecView.tsx`
- Create: `tests/PlanSpecView.test.tsx`

- [ ] **Step 1: Write component rendering test**

```typescript
// tests/PlanSpecView.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanSpecView from '../src/PlanSpecView';

const mockData = {
  analysisDate: '2026-03-25',
  period: '3/24',
  planSpecs: [
    { date: '3/24', member: '哲緯', commit: { title: 'docs: API design', sha: 'abc123', project: 'bigdata/api', url: '', source: 'gitlab' as const }, files: ['docs/specs/api.md'] }
  ],
  correlations: [
    { date: '3/24', member: '哲緯', status: 'matched' as const, specCommits: 1, dailyUpdateMention: true, matchedTasks: ['API 設計'], unmatchedSpecs: [], reasoning: 'OK' }
  ],
  summary: { totalSpecCommits: 1, totalCorrelations: 1, membersWithSpecs: 1, matched: 1, unmatched: 0, partial: 0 }
};

describe('PlanSpecView', () => {
  it('renders summary cards', () => {
    render(<PlanSpecView planAnalysisData={mockData} members={['哲緯']} memberColors={{ '哲緯': '#06b6d4' }} dates={['3/24']} activeDate="3/24" onDateSelect={() => {}} />);
    expect(screen.getByText(/Spec Commits/i)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders correlation status', () => {
    render(<PlanSpecView planAnalysisData={mockData} members={['哲緯']} memberColors={{ '哲緯': '#06b6d4' }} dates={['3/24']} activeDate="3/24" onDateSelect={() => {}} />);
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('handles empty data gracefully', () => {
    const emptyData = { ...mockData, planSpecs: [], correlations: [], summary: { totalSpecCommits: 0, totalCorrelations: 0, membersWithSpecs: 0, matched: 0, unmatched: 0, partial: 0 } };
    render(<PlanSpecView planAnalysisData={emptyData} members={[]} memberColors={{}} dates={['3/24']} activeDate="3/24" onDateSelect={() => {}} />);
    expect(screen.getByText(/無規劃文件/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/PlanSpecView.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PlanSpecView**

Create `src/PlanSpecView.tsx` with:
- Props interface matching App.tsx pass-through
- Summary stat cards (totalSpecCommits, matched, unmatched)
- Correlation grid (member × status)
- Expandable detail list
- Empty state message
- Dark theme + teal accent styling

(Full component ~120 lines — implement following existing CommitsView patterns for styling and layout)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/PlanSpecView.test.tsx`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/PlanSpecView.tsx tests/PlanSpecView.test.tsx
git commit -m "feat: add PlanSpecView dashboard tab"
```

---

### Task 9: Apps Script — Google Sheets Handler

**Files:**
- Modify: `appscript/Code.gs`

- [ ] **Step 1: Add planAnalysis handler in doPost()**

In the `doPost()` function, add after the `taskAnalysis` handler:

```javascript
if (data.planAnalysis) {
  writePlanAnalysis_(ss, data.planAnalysis);
  result.planSpecs = (data.planAnalysis.planSpecs || []).length;
}
```

- [ ] **Step 2: Implement writePlanAnalysis_()**

```javascript
function writePlanAnalysis_(ss, planAnalysis) {
  // Write planSpecs sheet
  var specsSheet = ss.getSheetByName('Plan Specs');
  if (!specsSheet) specsSheet = ss.insertSheet('Plan Specs');

  var specsRows = [['date', 'member', 'project', 'commitTitle', 'sha', 'files']];
  (planAnalysis.planSpecs || []).forEach(function(s) {
    specsRows.push([
      s.date,
      s.member,
      s.commit.project,
      s.commit.title,
      s.commit.sha,
      s.files.join(', ')
    ]);
  });
  if (specsRows.length > 1) {
    specsSheet.getRange(specsSheet.getLastRow() + 1, 1, specsRows.length, 6).setValues(specsRows);
  }

  // Write planCorrelations sheet
  var corrSheet = ss.getSheetByName('Plan Correlations');
  if (!corrSheet) corrSheet = ss.insertSheet('Plan Correlations');

  var corrRows = [['date', 'member', 'status', 'specCommits', 'matchedTasks', 'reasoning']];
  (planAnalysis.correlations || []).forEach(function(c) {
    corrRows.push([
      c.date,
      c.member,
      c.status,
      c.specCommits,
      (c.matchedTasks || []).join(', '),
      c.reasoning || ''
    ]);
  });
  if (corrRows.length > 1) {
    corrSheet.getRange(corrSheet.getLastRow() + 1, 1, corrRows.length, 6).setValues(corrRows);
  }
}
```

- [ ] **Step 3: Add dedup config**

In `DEDUP_KEY_CONFIG`, add:
```javascript
'Plan Specs':        { cols: [0, 1, 4], dateCols: [0] },     // date|member|sha
'Plan Correlations': { cols: [0, 1], dateCols: [0] },         // date|member
```

- [ ] **Step 4: Deploy**

Run: `bun run deploy:appscript`
Expected: Successful push and deploy

- [ ] **Step 5: Commit**

```bash
git add appscript/Code.gs
git commit -m "feat: add plan analysis handler to Apps Script"
```

---

### Task 10: /sync Stage 4 Integration

**Files:**
- Modify: `.claude/skills/sync.md`

- [ ] **Step 1: Add Stage 4 section to sync.md**

After Stage 3, add:

```markdown
### Stage 4: 規劃文件追蹤

Display:
\`\`\`
⏳ Stage 4 — 規劃文件追蹤
\`\`\`

**Can run in parallel with Stage 3** (both depend on Stage 2 only).

Step 1 — Detect spec commits:
\`\`\`bash
node scripts/detect-plan-specs.js --date <M/D> > /tmp/sync-plan-specs.json 2>/tmp/sync-plan-specs-stderr.txt
\`\`\`

If output is `[]` (no candidates):
\`\`\`
⏭️ Stage 4 — 無 spec commits
\`\`\`
Skip to Final Summary.

Step 2 — AI correlation analysis:
\`\`\`bash
node scripts/prepare-plan-analysis.js --date <M/D> --specs /tmp/sync-plan-specs.json | claude --print --model haiku > /tmp/sync-plan-analysis.json 2>/dev/null
\`\`\`

If successful:
1. Validate JSON
2. Copy to `public/plan-analysis.json`
3. Commit and push
4. POST to Google Sheets

Display:
\`\`\`
✅ Stage 4 — 規劃文件追蹤 (Xs)
  📋 Spec commits: 5 (3 members)
  ✅ 2 matched  🔴 1 unmatched
\`\`\`
```

- [ ] **Step 2: Update Final Summary to include Stage 4**

Add Plan Analysis section to the summary template.

- [ ] **Step 3: Update pipeline dependency table**

Note that Stage 3 and 4 can run in parallel.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/sync.md
git commit -m "feat: add Stage 4 (plan/spec tracking) to sync pipeline"
```

---

### Task 11: Documentation — CLAUDE.md Update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add scripts documentation**

In the Architecture section, add entries for:
- `scripts/detect-plan-specs.js` — description, usage, dependencies
- `scripts/prepare-plan-analysis.js` — description, usage, dependencies

- [ ] **Step 2: Add plan-analysis.json schema**

Add `public/plan-analysis.json` schema section after `task-analysis.json`.

- [ ] **Step 3: Update /sync description**

Update the pipeline description to mention Stage 4.

- [ ] **Step 4: Update Slash Commands table**

Add any new commands if applicable.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add plan/spec tracking to CLAUDE.md"
```

---

### Task 12: E2E Tests

**Files:**
- Create: `tests/e2e/plan-spec.spec.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
import { test, expect } from '@playwright/test';

test.describe('PlanSpecView', () => {
  test('tab is hidden when plan-analysis.json is missing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('規劃追蹤')).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `bun run test:e2e tests/e2e/plan-spec.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/plan-spec.spec.ts
git commit -m "test: add E2E tests for PlanSpecView"
```
