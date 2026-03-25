# Plan/Spec File Tracking — Design Spec

## Overview

Detect plan/spec documentation files in GitLab/GitHub commits, cross-reference with daily updates, and surface correlation insights for the engineering team lead.

## Problem

Team members commit planning documents (specs, designs, RFCs) but may not reflect this work in their daily updates. Currently there is no visibility into documentation activity within commits.

## Goals

1. Detect commits containing documentation files (*.md in docs/, specs/, plans/, design/ directories)
2. Cross-reference detected spec commits with daily update work items
3. Surface matched/unmatched correlations in the dashboard
4. Integrate into the existing /sync pipeline as Stage 4

## Non-Goals

- Fetching file changes for all commits (only keyword-filtered candidates)
- Analyzing the content of spec files themselves
- Replacing existing task analysis (this is an additional dimension)
- Date range backfill (single-date analysis only; backfill may be added later)

---

## Section 1: Data Pipeline

Two new scripts, executed sequentially in Stage 4.

### scripts/detect-plan-specs.js

**Input:** `--date M/D`

**Process:**
1. Read `public/gitlab-commits.json` — get all commits for the target date
2. Keyword filter on commit titles:
   - English regex: `/\b(plan|spec|design|docs?|rfc|proposal|architecture)\b/i`
   - Negative patterns to exclude false positives: `docker`, `archive`, `dockerfile`
   - Chinese keywords: 規劃、設計、架構、文件
   - Note: Chinese has no word boundaries; `includes()` matching is acceptable with known false-positive risk
3. For matched commits, call API to fetch file changes:
   - GitLab: `GET /api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits/:sha/diff`
     - Project path (e.g., `bigdata/api-gateway`) is URL-encoded since commit items store paths, not numeric IDs
   - GitHub: `GET /repos/{owner}/{repo}/commits/{sha}`
     - Extract owner/repo from project field (e.g., `bigdata-54837596/repo-name` → owner=`bigdata-54837596`, repo=`repo-name`)
     - SHA is 8 chars (truncated); use the commit `url` field to extract full SHA if API rejects short SHA
   - Rate limiting: retry with backoff on 429 (consistent with existing collection scripts)
   - Maximum 50 API calls per run; if candidates exceed 50, use title-only detection for the rest
4. Filter files to documentation paths:
   - Paths containing `docs/`, `specs/`, `plans/`, `design/` with `*.md` extension
   - Root-level `SPEC.md`, `PLAN.md`, `DESIGN.md`, `RFC-*.md`
5. Output candidate list as JSON to stdout

**Output format:**
```json
[
  {
    "date": "3/24",
    "member": "哲緯",
    "commit": {
      "title": "docs: add API design spec",
      "sha": "abc12345",
      "project": "bigdata/api-gateway",
      "url": "https://...",
      "source": "gitlab"
    },
    "files": [
      "docs/specs/api-gateway-design.md",
      "docs/plans/api-migration-plan.md"
    ]
  }
]
```

**Dependencies:** `gitlab-config.json` (API token), `github-config.json` (API token, optional), `public/gitlab-commits.json`

### scripts/prepare-plan-analysis.js

**Input:** `--date M/D --specs <path to detect output JSON>`

**Process:**
1. Read specs JSON from detect-plan-specs.js output
2. Read `public/raw_data.json` — extract `dailyUpdates` for the target date
   - `dailyUpdates` is populated by `/sync-daily-updates` and contains raw text keyed by date+member
   - If `dailyUpdates` is missing or has no entries for the target date, skip AI analysis and output `planSpecs` only (no correlations)
3. Keyword pre-filter: match project names and file path keywords against daily update text
   - Extract keywords from file paths: e.g., `docs/specs/api-gateway-design.md` → `api`, `gateway`, `design`
   - Match against daily update text (handles cross-language: English path names vs Chinese descriptions)
4. Compose Claude CLI prompt with:
   - Spec commits per member (project, files, commit title)
   - Daily update raw text per member
   - Instructions to classify each as matched/unmatched/partial
5. Output prompt to stdout (piped to `claude --print --model haiku`)

**Expected Claude output:** `public/plan-analysis.json` (see Section 2)

---

## Section 2: Data Schema

### public/plan-analysis.json

```json
{
  "analysisDate": "2026-03-25",
  "period": "3/24",
  "planSpecs": [
    {
      "date": "3/24",
      "member": "哲緯",
      "commit": {
        "title": "docs: add API design spec",
        "sha": "abc12345",
        "project": "bigdata/api-gateway",
        "url": "https://...",
        "source": "gitlab"
      },
      "files": [
        "docs/specs/api-gateway-design.md",
        "docs/plans/api-migration-plan.md"
      ]
    }
  ],
  "correlations": [
    {
      "date": "3/24",
      "member": "哲緯",
      "status": "matched",
      "specCommits": 2,
      "dailyUpdateMention": true,
      "matchedTasks": ["API gateway 設計文件撰寫"],
      "unmatchedSpecs": [],
      "reasoning": "daily update 提到 API gateway 設計，與 commit 的 spec 檔案一致"
    }
  ],
  "summary": {
    "totalSpecCommits": 5,
    "totalCorrelations": 3,
    "membersWithSpecs": 3,
    "matched": 2,
    "unmatched": 1,
    "partial": 0
  }
}
```

**Correlation status:**
- `matched` — daily update mentions corresponding spec work
- `unmatched` — spec commit exists but daily update has no mention
- `partial` — daily update mentions it but description is incomplete

---

## Section 3: Dashboard UI (Phased)

### Phase 1 — CommitsView Badge

- In the commit detail table, commits with plan/spec files show a 📋 badge
- Badge driven by `planSpecs` array (raw detection output), not AI correlations — works even if Claude CLI fails
- Hover tooltip lists the doc file paths
- Uses teal accent color (#06b6d4) for consistency

### Phase 2 — PlanSpecView Tab

New fifth tab: "規劃追蹤"

**Layout:**
- **Top:** Stat cards — total spec commits, matched count, unmatched count
- **Middle:** Member × Date correlation grid
  - `matched` = green ✅
  - `unmatched` = red 🔴
  - `partial` = yellow ⚠️
  - No spec commit = grey —
- **Bottom:** Expandable detail list — spec commit info + corresponding daily update text

**Styling:** Dark theme consistent with existing views. Teal (#06b6d4) accent.

**Graceful degradation:** Tab hidden when `plan-analysis.json` is missing or empty (same pattern as Commits tab hiding when `commitData` is null).

### Phase 3 — Task Analysis Integration

- Extend `prepare-task-analysis.js` prompt to include plan/spec dimension
- Add spec-related warnings to existing task warnings
- Example: "哲緯 commit 了 3 個 spec 文件但 daily update 只報 1H 文件工作"

---

## Section 4: /sync Stage 4 Integration

### Pipeline (4 stages)

| Stage | Name | Dependencies |
|-------|------|-------------|
| 1 | 平行收集 | — |
| 2 | 一致性分析 | Stage 1 |
| 3 | 任務合理性 | Stage 2 |
| 4 | 規劃文件追蹤 | Stage 2 |

**Note:** Stage 3 and Stage 4 are independent of each other — they can run **in parallel** after Stage 2 completes.

### Stage 4 Execution

```bash
# Step 1: Detect spec commits
node scripts/detect-plan-specs.js --date <M/D> \
  > /tmp/sync-plan-specs.json 2>/tmp/sync-plan-specs-stderr.txt

# Step 2: AI correlation analysis
node scripts/prepare-plan-analysis.js \
  --date <M/D> \
  --specs /tmp/sync-plan-specs.json \
  | claude --print --model haiku \
  > /tmp/sync-plan-analysis.json
```

**On success:**
1. Validate JSON output
2. Copy to `public/plan-analysis.json`
3. Commit and push
4. POST to Google Sheets:
```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"planAnalysis\": $(cat public/plan-analysis.json)}" \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)
curl -s "$REDIRECT_URL"
```

**Display:**
```
✅ Stage 4 — 規劃文件追蹤 (Xs)
  📋 Spec commits: 5 (3 members)
  ✅ 2 matched  🔴 1 unmatched
```

**Error handling:**
- No candidates found → skip Stage 4, display "無 spec commits"
- API call failure → warning, don't block (Stage 1-3 results already committed)
- Claude CLI failure → same fallback as Stage 3

### Google Sheets Integration

**New sheets:**

1. **planSpecs** — one row per spec commit
   - Columns: date | member | project | commitTitle | sha | files

2. **planCorrelations** — one row per member-date correlation
   - Columns: date | member | status | specCommits | matchedTasks | reasoning

**POST handler:** Apps Script `doPost()` detects `planAnalysis` key and writes to both sheets. Same pattern as existing `taskAnalysis` handler.

**No changes to existing 7 sheets.**

---

## Section 5: Testing Strategy

### Unit Tests (Vitest)

**detect-plan-specs.js:**
- Keyword matching: English/Chinese title patterns (hit and miss cases)
- File path filtering: `docs/*.md` hits, `src/*.ts` misses
- Empty result handling: no candidate commits → empty JSON array
- API response parsing: GitLab diff format, GitHub files format

**prepare-plan-analysis.js:**
- Prompt output format validation
- Keyword pre-filter logic: project name matching
- Graceful handling when no dailyUpdates exist

**plan-analysis.json schema validation:**
- Required fields present
- Status values are valid enum
- Summary counts match data

**PlanSpecView component:**
- Correlation grid renders correctly
- Status badges display with correct colors
- Empty data → graceful "no data" message

### E2E Tests (Playwright)

- PlanSpecView tab clickable and renders
- 📋 badge displays in CommitsView for spec commits
- `plan-analysis.json` missing → feature gracefully hidden

### TDD Workflow

All tests follow superpowers TDD:
RED → Verify RED → GREEN → Verify GREEN → REFACTOR + /simplify

---

## Implementation Phases

| Phase | Scope | Deliverables |
|-------|-------|-------------|
| 1 | Data pipeline + schema | `detect-plan-specs.js`, `prepare-plan-analysis.js`, `plan-analysis.json`, unit tests |
| 2 | Frontend types + data loading | Update `src/types.ts` (add `PlanAnalysisData`), `src/main.tsx` (fetch `plan-analysis.json`), `src/App.tsx` (routing + state) |
| 3 | CommitsView badge | 📋 badge in commit table, tooltip, unit + E2E tests |
| 4 | PlanSpecView tab | New dashboard tab with correlation grid, unit + E2E tests |
| 5 | /sync Stage 4 | Pipeline integration, Google Sheets handler, sync skill update |
| 6 | Task analysis integration | Extended prompt, combined warnings |
| 7 | Documentation | Update CLAUDE.md with new scripts, schema, and Stage 4 pipeline |
