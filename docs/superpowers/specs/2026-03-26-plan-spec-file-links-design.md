# Plan/Spec 檔案連結功能設計

## 概述

在規劃追蹤頁面（PlanSpecView）中，為 spec 檔案添加可點擊連結，讓用戶能直接從 dashboard 訪問 Git 平台上的檔案內容和 commit diff。

## 目標

- 檔案名稱可點擊，連到 Git 平台上該 commit SHA 版本的檔案全文（blob URL）
- 每個檔案旁提供 diff icon，連到 commit diff 頁面查看變更內容
- 不修改 data pipeline 和 JSON schema，所有 URL 在前端運行時構建

## 設計決策

| 決策 | 選擇 | 理由 |
|------|------|------|
| URL 定位方式 | commit SHA（非 default branch） | 永久連結，即使檔案後來被修改或刪除也能訪問 |
| URL 生成位置 | 前端運行時 | 現有資料已齊全，不需改 schema/pipeline |
| UI 呈現 | 檔名=blob 連結 + diff icon | 直覺且輕量，符合 dashboard 緊湊風格 |
| Diff 連結策略 | 連到 commit URL（已有） | 不需構建 per-file diff anchor，commit 頁面自然包含所有檔案 diff |

## 變更範圍

### 1. 新增 URL 工具函式（`src/utils.ts`）

```typescript
/** 從 commit URL 提取 project/repo base URL */
function extractRepoBase(commitUrl: string, source: string): string

/** 構建檔案 blob URL（指向特定 commit SHA 版本） */
function buildFileBlobUrl(
  commit: { url: string; sha: string; source: string },
  filePath: string
): string

// GitLab: {repoBase}/-/blob/{sha}/{filePath}
// GitHub: {repoBase}/blob/{sha}/{filePath}
```

`extractRepoBase` 邏輯：
- GitLab commit URL 格式: `https://biglab.buygta.today/{project}/-/commit/{sha}`
  - 移除 `/-/commit/{sha}` 得到 base
- GitHub commit URL 格式: `https://github.com/{org}/{repo}/commit/{sha}`
  - 移除 `/commit/{sha}` 得到 base

Diff URL 不需要另外構建，直接使用 `commit.url`（已存在於資料中）。

### 2. 修改 PlanSpecView（`src/PlanSpecView.tsx`）

現有檔案 badge 渲染（純文字）：
```tsx
<span style={{...}}>{file}</span>
```

改為：
```tsx
<a href={buildFileBlobUrl(spec.commit, file)}
   target="_blank" rel="noopener noreferrer"
   style={{...teal link styling...}}>
  {displayFileName}
</a>
<a href={spec.commit.url}
   target="_blank" rel="noopener noreferrer"
   title="查看 diff"
   style={{...diff icon styling...}}>
  ↔
</a>
```

### UI 樣式

- 檔案連結：teal 色（`#06b6d4`），hover 時加底線
- diff icon：較小字號，teal 色，hover 時 opacity 變化
- 檔案名稱顯示：截取最後的檔名部分（如 `xxx.md`），hover tooltip 顯示完整路徑
- 維持現有 badge 外觀，僅將文字改為可點擊連結

## 不變更項目

- `plan-analysis.json` schema 不變
- `detect-plan-specs.js` 不變
- `prepare-plan-analysis.js` 不變
- `src/types.ts` 不變
- 現有測試不受影響

## 測試策略

- 單元測試 `extractRepoBase`：GitLab / GitHub URL 格式
- 單元測試 `buildFileBlobUrl`：GitLab / GitHub + 各種檔案路徑
- 元件測試 PlanSpecView：驗證連結 href、target="_blank"、title 屬性
- Playwright E2E：驗證檔案連結可見且可點擊
