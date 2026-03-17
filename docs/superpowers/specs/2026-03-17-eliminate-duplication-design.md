# Phase A: Eliminate Code Duplication via Bun + Vite + TypeScript

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Eliminate 95% code duplication between `index.html` and `appscript/index.html` by introducing Bun + Vite build pipeline with TypeScript

## Problem

`index.html` (1,556 lines) and `appscript/index.html` (1,585 lines) share 95% identical code. The only difference is 61 lines of data-loading logic (`fetch` vs `google.script.run`). Every UI change requires manual synchronization of both files — a maintenance burden and divergence risk.

## Solution

Introduce Bun (runtime) + Vite (bundler/dev server) + TypeScript. Extract shared UI code into `src/`, define a `LoadData` interface, and provide two entry points. Apps Script version is auto-generated via a post-build script.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Fast, modern, replaces Node for scripts |
| Bundler | Vite | HTML entry support, HMR, Vitest integration |
| Language | TypeScript | Type safety, better refactoring support |
| Apps Script build | Post-build script | Simple, no custom Vite plugin needed |

## File Structure

```
root/
├── src/
│   ├── main.tsx              ← GitHub Pages entry (fetch-based loading)
│   ├── main.appscript.tsx    ← Apps Script entry (google.script.run loading)
│   ├── App.tsx               ← Dashboard component, accepts loadData prop (~838 lines)
│   ├── CommitsView.tsx       ← Commits tab component (~488 lines)
│   ├── components.tsx        ← Shared UI (CustomTooltip, CardPanel, etc.)
│   ├── types.ts              ← Shared type definitions
│   ├── constants.ts          ← COLORS, SEVERITY_COLORS, etc.
│   ├── utils.ts              ← Utility functions (date, formatting)
│   ├── styles.css            ← Extracted from index.html <style> block
│   └── google.script.d.ts    ← Type declarations for google.script.run
├── index.html                ← Vite HTML entry (<script type="module" src="/src/main.tsx">)
├── public/
│   ├── raw_data.json         ← Moved from root (Vite copies to dist/ as-is)
│   ├── gitlab-commits.json   ← Moved from root
│   └── task-analysis.json    ← Moved from root
├── appscript/
│   ├── Code.gs               ← Unchanged
│   └── index.html            ← Auto-generated (gitignored)
├── scripts/
│   ├── build-appscript.ts    ← Post-build: inline bundle → appscript/index.html
│   ├── parse-daily-updates.js
│   ├── fetch-gitlab-commits.js
│   ├── prepare-task-analysis.js
│   └── merge-daily-data.js
├── tests/                    ← Unchanged, Vitest continues to work
├── vite.config.ts
├── tsconfig.json
├── package.json
└── bun.lock
```

## Data Loading Abstraction

### Type Interface

```typescript
// src/types.ts
interface MemberHours {
  total: number | null;
  meeting: number | null;
  dev: number | null;
}

interface Issue {
  member: string;
  severity: string;
  text: string;
}

interface LeaveRange {
  start: string;
  end: string;
}

interface CommitItem {
  title: string;
  sha: string;
  project: string;
  url: string;
}

interface MemberCommits {
  count: number;
  projects: string[];
  items: CommitItem[];
}

interface CommitData {
  commits: Record<string, Record<string, MemberCommits>>;
  analysis: Record<string, Record<string, { status: string; commitCount: number; hours: number | null }>>;
  projectRisks: Array<{ project: string; soloContributor: string; severity: string }>;
}

interface TaskWarning {
  date: string;
  member: string;
  severity: string;
  type: string;
  task: string;
  commits: string;
  reasoning: string;
}

interface TaskAnalysisData {
  analysisDate: string;
  period: string;
  warnings: TaskWarning[];
  summary: { totalWarnings: number; critical: number; warning: number; caution: number };
}

interface DashboardData {
  rawData: Record<string, Record<string, MemberHours>>;
  issues: Issue[];
  leave: Record<string, LeaveRange[]>;
  commitData: CommitData | null;
  taskAnalysisData: TaskAnalysisData | null;
}

type LoadData = () => Promise<DashboardData>;
```

### GitHub Pages Entry

```typescript
// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type { LoadData } from "./types";

const loadData: LoadData = async () => {
  const [raw, commits, tasks] = await Promise.all([
    fetch("raw_data.json").then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch("gitlab-commits.json").then(r => r.ok ? r.json() : null).catch(() => null),
    fetch("task-analysis.json").then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return {
    rawData: raw.rawData,
    issues: raw.issues || [],
    leave: raw.leave || {},
    commitData: commits,
    taskAnalysisData: tasks,
  };
};

createRoot(document.getElementById("root")!).render(<App loadData={loadData} />);
```

### Apps Script Entry

```typescript
// src/main.appscript.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type { LoadData } from "./types";

const gsr = <T,>(fn: string): Promise<T> =>
  new Promise((resolve, reject) =>
    google.script.run
      .withSuccessHandler((s: string) => resolve(JSON.parse(s)))
      .withFailureHandler(reject)
      [fn]()
  );

const loadData: LoadData = async () => {
  const [raw, commits, tasks] = await Promise.all([
    gsr<{ rawData: any; issues: any; leave: any }>("getDashboardData"),
    gsr<any>("getCommitData").catch(() => null),
    gsr<any>("getTaskAnalysisData").catch(() => null),
  ]);
  return {
    rawData: raw.rawData,
    issues: raw.issues || [],
    leave: raw.leave || {},
    commitData: commits,
    taskAnalysisData: tasks,
  };
};

createRoot(document.getElementById("root")!).render(<App loadData={loadData} />);
```

**Note on behavioral change:** The current Apps Script version uses a callback-based `tryFinish` pattern with manual coordination of three independent `google.script.run` calls. The new Promise wrapper with `Promise.all` is a semantic change. `google.script.run` supports concurrent calls in the V8 runtime (which this project uses per `appsscript.json`), so this should work correctly. If issues arise, fallback to sequential `await` calls instead of `Promise.all`.

### App Component

```typescript
// src/App.tsx
import type { LoadData } from "./types";

const App: React.FC<{ loadData: LoadData }> = ({ loadData }) => {
  // All existing Dashboard logic here
  // useEffect calls loadData() instead of inline fetch/google.script.run
};
```

## Build Pipeline

### Vite Config

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
```

### Vite Config for Apps Script Build

A separate Vite config (`vite.config.appscript.ts`) for building the Apps Script entry:

```typescript
// vite.config.appscript.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-appscript",
    cssCodeSplit: false, // Force all CSS into a single file
    rollupOptions: {
      input: "src/main.appscript.tsx",
      output: {
        // Single file output — Apps Script HtmlService requires self-contained HTML
        inlineDynamicImports: true,
        entryFileNames: "bundle.js",
        assetFileNames: "[name][extname]", // Predictable names, no hash
      },
    },
  },
});
```

### Apps Script Build Script

```typescript
// scripts/build-appscript.ts
// 1. Run: vite build --config vite.config.appscript.ts
//    → outputs dist-appscript/bundle.js (single file, all deps inlined)
// 2. Read dist-appscript/bundle.js
// 3. Glob for dist-appscript/*.css (Vite CSS output, predictable name via assetFileNames config)
// 4. Generate self-contained HTML:
//    - <head>: Google Fonts <link>, <style>{css contents}</style>
//    - <body>: <div id="root"></div>, <script>{js bundle}</script>
// 5. Write to appscript/index.html
//
// Implementation: use Bun.file() to read, template literal to assemble,
// Bun.write() to output. ~30 lines of code.
```

### Package Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:appscript": "vite build --config vite.config.appscript.ts && bun scripts/build-appscript.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy:appscript": "bun run build:appscript && cd appscript && clasp push"
  }
}
```

### Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

## CI/CD Changes

### GitHub Actions (pages.yml)

```yaml
# Before:
#   - Checkout → Upload entire repo → Deploy
# After:
steps:
  - uses: actions/checkout@v4
  - uses: oven-sh/setup-bun@v2
  - run: bun install
  - run: bun run build
  - uses: actions/configure-pages@v5
  - uses: actions/upload-pages-artifact@v3
    with:
      path: dist
  - uses: actions/deploy-pages@v4
```

## Path Updates Required

### Scripts

| File | Change |
|------|--------|
| `scripts/merge-daily-data.js` | No change needed — takes file paths as CLI arguments, paths updated in skills |
| `scripts/fetch-gitlab-commits.js` | Read `public/raw_data.json`, write `public/gitlab-commits.json` |
| `scripts/parse-daily-updates.js` | Update hardcoded `ROOT` path reference from `raw_data.json` to `public/raw_data.json` (line ~321) |
| `scripts/prepare-task-analysis.js` | Read from `public/` |

### Skills

| File | Changes |
|------|---------|
| `.claude/skills/sync-daily-updates.md` | `raw_data.json` → `public/raw_data.json` (grep all occurrences) |
| `.claude/skills/sync-gitlab-commits.md` | `raw_data.json` → `public/raw_data.json`, `gitlab-commits.json` → `public/gitlab-commits.json` (grep all occurrences) |
| `.claude/skills/fetch-daily-updates.md` | `raw_data.json` → `public/raw_data.json` (grep all occurrences) |
| `.claude/skills/backfill-daily-updates.md` | `raw_data.json` → `public/raw_data.json` (grep all occurrences) |

### CLAUDE.md

| Section | Change |
|---------|--------|
| Development | `python3 -m http.server` → `bun run dev` |
| Architecture | Update file paths, add `src/` structure description |
| Deployment | Add build step description |
| Key Conventions | Remove "sync appscript/index.html" convention (now automated) |

### .gitignore

Add: `appscript/index.html` (now a build artifact)

### Tests

| File | Change |
|------|--------|
| `tests/data-schema.test.js` | Read from `public/raw_data.json` |
| `tests/index-loading.test.js` | Update hardcoded path from `raw_data.json` to `public/raw_data.json` |

## Migration Steps

1. Initialize Bun + Vite + TypeScript (`bun init`, `vite.config.ts`, `tsconfig.json`)
2. Install dependencies (`react`, `react-dom`, `recharts`, `vite`, `@vitejs/plugin-react`, TypeScript types)
3. Move JSON data files to `public/`
4. Extract `<style>` from `index.html` to `src/styles.css`
5. Define types in `src/types.ts`, constants in `src/constants.ts`, utils in `src/utils.ts`
6. Extract Dashboard component to `src/App.tsx` (convert to TypeScript)
7. Create `src/main.tsx` (GitHub Pages entry) and `src/main.appscript.tsx` (Apps Script entry)
8. Rewrite `index.html` as Vite entry (`<script type="module" src="/src/main.tsx">`)
9. Write `src/google.script.d.ts` for Apps Script type declarations
10. Verify `bun run dev` — all 4 tabs functional
11. Write `scripts/build-appscript.ts`
12. Verify `bun run build` — `dist/` output works
13. Verify `bun run build:appscript` — Apps Script version works
14. Update scripts (`merge-daily-data.js`, `fetch-gitlab-commits.js`, `prepare-task-analysis.js`) for `public/` paths
15. Update skills (`.claude/skills/*.md`) for `public/` paths
16. Update CLAUDE.md
17. Update `.gitignore` (add `appscript/index.html`, `dist/`, `node_modules/`)
18. Update CI/CD workflow (`.github/workflows/pages.yml`)
19. Run `bun test` — all tests pass
20. Delete old monolithic `appscript/index.html` from git tracking

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Recharts UMD → ESM behavior diff | Chart rendering issues | Verify all chart types after migration |
| Babel → TypeScript transpilation diff | Syntax errors | Start with lenient tsconfig, tighten later |
| `google.script.run` types missing | Compile failure | Write `google.script.d.ts` declaration file |
| `google.script.run` Promise.all concurrency | Callbacks may not fire in V8 runtime | Fallback to sequential `await` if issues arise |
| CI build failure blocks deploy | Site down | Keep old workflow until new one verified |
| Existing tests break | Red tests | Update path references in `data-schema.test.js` and `index-loading.test.js` |
| Script path changes break sync skills | Data sync fails | Update and test each skill individually |

## Acceptance Criteria

- [ ] `bun run dev` — all 4 tabs (Daily, Trend, Weekly, Commits) match current behavior
- [ ] `bun run build` — `dist/` deployment identical to current
- [ ] `bun run build:appscript` — Apps Script version functional
- [ ] `bun test` — all existing tests pass
- [ ] UI changes require editing only `src/` — no manual sync needed
- [ ] `appscript/index.html` auto-generated from build
- [ ] All skills work with new `public/` paths
- [ ] CI/CD deploys from `dist/` successfully
