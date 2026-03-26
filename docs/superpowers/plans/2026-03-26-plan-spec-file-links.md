# Plan/Spec 檔案連結功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在規劃追蹤頁面中為 spec 檔案添加可點擊連結，讓用戶能直接從 dashboard 訪問 GitLab/GitHub 上的檔案全文和 commit diff。

**Architecture:** 新增兩個純函式 `extractRepoBase` 和 `buildFileBlobUrl` 到 `src/utils.ts`，在 `PlanSpecView.tsx` 中將檔案 badge 從純文字改為帶連結的 `<a>` 標籤。Diff 連結直接使用現有 `commit.url`。不修改任何 data pipeline 或 JSON schema。

**Tech Stack:** TypeScript, React 18, Vitest, @testing-library/react, Playwright

---

### Task 1: 新增 `extractRepoBase` 函式

**Files:**
- Modify: `src/utils.ts` (在檔案末尾新增)
- Test: `tests/unit/utils.test.ts`

- [ ] **Step 1: Write the failing test for GitLab URL**

在 `tests/unit/utils.test.ts` 末尾新增：

```typescript
import { dateToNum, isOnLeave, getStatus, getBarColor, getTrendIcon, getWeekRange, extractRepoBase } from "../../src/utils";

describe("extractRepoBase", () => {
  it("extracts base from GitLab commit URL", () => {
    expect(extractRepoBase(
      "https://biglab.buygta.today/KEYPO/keypo-frontend-2023/-/commit/25386ec0",
      "gitlab"
    )).toBe("https://biglab.buygta.today/KEYPO/keypo-frontend-2023");
  });

  it("extracts base from GitLab nested project URL", () => {
    expect(extractRepoBase(
      "https://biglab.buygta.today/KEYPO/keypo-engine/keypo-engine-api-gateway/-/commit/a390f9a5",
      "gitlab"
    )).toBe("https://biglab.buygta.today/KEYPO/keypo-engine/keypo-engine-api-gateway");
  });
});
```

Note: 需要同時更新檔案頂部的 import，加入 `extractRepoBase`。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/unit/utils.test.ts`
Expected: FAIL with "extractRepoBase is not exported"

- [ ] **Step 3: Write minimal implementation**

在 `src/utils.ts` 末尾新增：

```typescript
export function extractRepoBase(commitUrl: string, source: string): string {
  if (source === "gitlab") {
    return commitUrl.replace(/\/-\/commit\/[^/]+$/, "");
  }
  return commitUrl.replace(/\/commit\/[^/]+$/, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/unit/utils.test.ts`
Expected: PASS

- [ ] **Step 5: Add GitHub test cases**

在 `extractRepoBase` describe 區塊內繼續新增：

```typescript
  it("extracts base from GitHub commit URL", () => {
    expect(extractRepoBase(
      "https://github.com/bigdata-54837596/some-repo/commit/abc12345",
      "github"
    )).toBe("https://github.com/bigdata-54837596/some-repo");
  });

  it("returns original URL if pattern not matched", () => {
    expect(extractRepoBase("https://example.com/unknown", "gitlab")).toBe("https://example.com/unknown");
  });
```

- [ ] **Step 6: Run test to verify all pass**

Run: `bun run test -- tests/unit/utils.test.ts`
Expected: PASS (all 4 extractRepoBase tests)

- [ ] **Step 7: Commit**

```bash
git add src/utils.ts tests/unit/utils.test.ts
git commit -m "feat: add extractRepoBase utility for plan spec file links"
```

---

### Task 2: 新增 `buildFileBlobUrl` 函式

**Files:**
- Modify: `src/utils.ts` (在 `extractRepoBase` 後新增)
- Modify: `tests/unit/utils.test.ts`

- [ ] **Step 1: Write the failing test for GitLab blob URL**

在 `tests/unit/utils.test.ts` 末尾新增，並在 import 行加入 `buildFileBlobUrl`：

```typescript
import { dateToNum, isOnLeave, getStatus, getBarColor, getTrendIcon, getWeekRange, extractRepoBase, buildFileBlobUrl } from "../../src/utils";

describe("buildFileBlobUrl", () => {
  it("builds GitLab blob URL", () => {
    const commit = {
      url: "https://biglab.buygta.today/llmprojects/keypo-agent/-/commit/23ceb981",
      sha: "23ceb981",
      source: "gitlab" as const,
    };
    expect(buildFileBlobUrl(commit, "docs/superpowers/specs/2026-03-24-keypo-http-client-v3-design.md"))
      .toBe("https://biglab.buygta.today/llmprojects/keypo-agent/-/blob/23ceb981/docs/superpowers/specs/2026-03-24-keypo-http-client-v3-design.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/unit/utils.test.ts`
Expected: FAIL with "buildFileBlobUrl is not exported"

- [ ] **Step 3: Write minimal implementation**

在 `src/utils.ts` 的 `extractRepoBase` 之後新增：

```typescript
export function buildFileBlobUrl(
  commit: { url: string; sha: string; source: string },
  filePath: string
): string {
  const base = extractRepoBase(commit.url, commit.source);
  if (commit.source === "gitlab") {
    return `${base}/-/blob/${commit.sha}/${filePath}`;
  }
  return `${base}/blob/${commit.sha}/${filePath}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/unit/utils.test.ts`
Expected: PASS

- [ ] **Step 5: Add GitHub and edge case tests**

在 `buildFileBlobUrl` describe 區塊內繼續新增：

```typescript
  it("builds GitHub blob URL", () => {
    const commit = {
      url: "https://github.com/bigdata-54837596/some-repo/commit/abc12345",
      sha: "abc12345",
      source: "github" as const,
    };
    expect(buildFileBlobUrl(commit, "docs/plans/feature.md"))
      .toBe("https://github.com/bigdata-54837596/some-repo/blob/abc12345/docs/plans/feature.md");
  });

  it("handles nested GitLab project paths", () => {
    const commit = {
      url: "https://biglab.buygta.today/KEYPO/keypo-engine/keypo-engine-api-gateway/-/commit/a390f9a5",
      sha: "a390f9a5",
      source: "gitlab" as const,
    };
    expect(buildFileBlobUrl(commit, "docs/decisions/015-leaky-bucket-rate-limiting.md"))
      .toBe("https://biglab.buygta.today/KEYPO/keypo-engine/keypo-engine-api-gateway/-/blob/a390f9a5/docs/decisions/015-leaky-bucket-rate-limiting.md");
  });
```

- [ ] **Step 6: Run test to verify all pass**

Run: `bun run test -- tests/unit/utils.test.ts`
Expected: PASS (all buildFileBlobUrl tests)

- [ ] **Step 7: Commit**

```bash
git add src/utils.ts tests/unit/utils.test.ts
git commit -m "feat: add buildFileBlobUrl utility for plan spec file links"
```

---

### Task 3: 更新 PlanSpecView — 檔案連結 UI

**Files:**
- Modify: `src/PlanSpecView.tsx:1-4` (新增 import)
- Modify: `src/PlanSpecView.tsx:103-110` (檔案 badge 區域)
- Test: `tests/components/PlanSpecView.test.tsx`

- [ ] **Step 1: Write the failing test for file link rendering**

在 `tests/components/PlanSpecView.test.tsx` 中，先更新 `mockData` 的 commit URL 使其非空（目前是 `url: ''`），然後新增測試：

將 mockData 中的 `url: ''` 改為 `url: 'https://biglab.buygta.today/bigdata/api/-/commit/abc123'`。

然後在 describe 區塊內新增：

```typescript
  it('renders file as blob link with correct href', () => {
    render(<PlanSpecView {...baseProps} />);
    const fileLink = screen.getByRole('link', { name: /api\.md/ });
    expect(fileLink).toHaveAttribute('href', 'https://biglab.buygta.today/bigdata/api/-/blob/abc123/docs/specs/api.md');
    expect(fileLink).toHaveAttribute('target', '_blank');
    expect(fileLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/components/PlanSpecView.test.tsx`
Expected: FAIL — no link element found (currently rendered as `<span>`)

- [ ] **Step 3: Implement file blob link in PlanSpecView**

Modify `src/PlanSpecView.tsx`:

Add import at top:
```typescript
import { buildFileBlobUrl } from "./utils";
```

Replace lines 103-110 (the file badge rendering) with:

```tsx
<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
  {spec.files.map((f, j) => {
    const fileName = f.split('/').pop() || f;
    return (
      <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <a
          href={buildFileBlobUrl(spec.commit, f)}
          target="_blank"
          rel="noopener noreferrer"
          title={f}
          style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4,
            background: COLORS.tealDim, color: COLORS.teal,
            fontFamily: "JetBrains Mono, SF Mono, monospace",
            textDecoration: "none",
          }}
        >
          {fileName}
        </a>
        <a
          href={spec.commit.url}
          target="_blank"
          rel="noopener noreferrer"
          title="查看 diff"
          style={{
            fontSize: 10, color: COLORS.teal, opacity: 0.6,
            textDecoration: "none",
          }}
        >
          ↔
        </a>
      </span>
    );
  })}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/components/PlanSpecView.test.tsx`
Expected: PASS

- [ ] **Step 5: Add test for diff icon link**

在 describe 區塊內新增：

```typescript
  it('renders diff icon link pointing to commit URL', () => {
    render(<PlanSpecView {...baseProps} />);
    const diffLink = screen.getByRole('link', { name: '↔' });
    expect(diffLink).toHaveAttribute('href', 'https://biglab.buygta.today/bigdata/api/-/commit/abc123');
    expect(diffLink).toHaveAttribute('target', '_blank');
    expect(diffLink).toHaveAttribute('title', '查看 diff');
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test -- tests/components/PlanSpecView.test.tsx`
Expected: PASS

- [ ] **Step 7: Add test for file name truncation with tooltip**

在 describe 區塊內新增：

```typescript
  it('shows filename only in link text with full path as tooltip', () => {
    render(<PlanSpecView {...baseProps} />);
    const fileLink = screen.getByRole('link', { name: /api\.md/ });
    expect(fileLink).toHaveTextContent('api.md');
    expect(fileLink).toHaveAttribute('title', 'docs/specs/api.md');
  });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run test -- tests/components/PlanSpecView.test.tsx`
Expected: PASS

- [ ] **Step 9: Update existing test for file text assertion**

原有測試 `'renders spec commit details'` 中有這行：
```typescript
expect(screen.getByText('docs/specs/api.md')).toBeInTheDocument();
```

由於檔名現在只顯示 `api.md`（完整路徑在 title 屬性中），需更新為：
```typescript
expect(screen.getByText('api.md')).toBeInTheDocument();
```

- [ ] **Step 10: Run all tests to verify nothing broken**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add src/PlanSpecView.tsx tests/components/PlanSpecView.test.tsx
git commit -m "feat: add clickable file links and diff icons to PlanSpecView"
```

---

### Task 4: Playwright E2E 測試

**Files:**
- Create: `tests/e2e/plan-spec-links.spec.ts`

- [ ] **Step 1: Write E2E test**

建立 `tests/e2e/plan-spec-links.spec.ts`：

```typescript
import { test, expect } from '@playwright/test';

test.describe('Plan/Spec file links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to Plan Tracking tab
    await page.click('text=規劃追蹤');
  });

  test('spec file names are clickable links with blob URLs', async ({ page }) => {
    const fileLink = page.locator('a[title*="docs/"]').first();
    if (await fileLink.isVisible()) {
      const href = await fileLink.getAttribute('href');
      expect(href).toMatch(/\/-\/blob\/[a-f0-9]+\/|\/blob\/[a-f0-9]+\//);
      expect(await fileLink.getAttribute('target')).toBe('_blank');
    }
  });

  test('diff icon links point to commit URL', async ({ page }) => {
    const diffLink = page.locator('a:has-text("↔")').first();
    if (await diffLink.isVisible()) {
      const href = await diffLink.getAttribute('href');
      expect(href).toMatch(/\/-\/commit\/[a-f0-9]+|\/commit\/[a-f0-9]+/);
      expect(await diffLink.getAttribute('title')).toBe('查看 diff');
    }
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `bun run test:e2e -- tests/e2e/plan-spec-links.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/plan-spec-links.spec.ts
git commit -m "test: add Playwright E2E tests for plan spec file links"
```

---

### Task 5: 全套測試驗證 + 最終 commit

- [ ] **Step 1: Run all unit + component tests**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 2: Run all E2E tests**

Run: `bun run test:e2e`
Expected: All tests PASS

- [ ] **Step 3: Visual verification**

Run: `bun run dev`
Open `http://localhost:5173`, navigate to「規劃追蹤」tab, verify:
- 檔案名稱顯示為可點擊的 teal 連結
- Hover 檔名顯示完整路徑 tooltip
- 每個檔案旁有 `↔` diff icon
- 點擊檔名在新分頁開啟 GitLab/GitHub blob 頁面
- 點擊 `↔` 在新分頁開啟 commit diff 頁面
