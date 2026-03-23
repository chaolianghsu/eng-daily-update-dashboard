# Daily Update 狀態區分 + Commit Datetime 保留

## 問題

1. `raw_data.json` 中 `total: null` 無法區分「未回覆」vs「有回覆但沒寫工時」vs「請假」
2. `gitlab-commits.json` 的 commit items 不含 `datetime`，CommitsView 無法顯示提交時間

## 設計

### Feature 1: Daily Update 狀態區分

#### 資料層

`MemberHours` 新增 `status` 欄位：

```ts
export interface MemberHours {
  total: number | null;
  meeting: number | null;
  dev: number | null;
  status: 'reported' | 'unreported' | 'replied_no_hours' | 'zero' | 'leave';
}
```

| status | 含義 | total 值 |
|--------|------|----------|
| `reported` | 正常回報，有工時數字 | `> 0` |
| `zero` | 明確回報 0 小時 | `0` |
| `replied_no_hours` | 有在 thread 回覆但 parser 無法解析出工時 | `null` |
| `unreported` | 完全未在 thread 留言 | `null` |
| `leave` | 請假（由 leave 資料匹配） | `null` |

#### Parser 改動 (`scripts/parse-daily-updates.js`)

1. `parseHoursFromText()` 回傳值新增 `status`:
   - 解析出工時且 > 0 → `status: 'reported'`
   - 解析出工時且 === 0 → `status: 'zero'`
   - 無法解析出工時 → `status: 'replied_no_hours'`

2. `fillEntry` 步驟（為未回覆成員填充 null）：
   - 設定 `status: 'unreported'`

3. leave 判定階段：
   - 若 `total === null` 且日期在 leave 範圍內 → 覆寫 `status: 'leave'`

#### Issues 邏輯改動

| 現況 | 改動 |
|------|------|
| `total === null` → 🔴 未回報 | `status === 'unreported'` → 🔴 未回報 |
| （無法區分） | `status === 'replied_no_hours'` → 🟠 有回覆無工時 |
| `total === null` + leave → 🟠 休假 | `status === 'leave'` → 🟠 休假 |

#### UI 影響

DailyView 的 "—" placeholder 根據 status 區分顯示：
- `unreported` → 紅色 "未報"
- `replied_no_hours` → 橙色 "無工時"
- `leave` → 橙色 "假"
- `zero` → 顯示 "0"

#### 向後相容

讀取 `raw_data.json` 時若 `status` 欄位不存在，fallback：
- `total !== null` → `'reported'`
- `total === null` → `'unreported'`

歷史資料已用 `scripts/backfill-status.js` 補上 status 欄位（無法區分 `unreported` vs `replied_no_hours`，統一標為 `unreported`）。

### Feature 2: Commit Datetime 保留

#### 資料層

`CommitItem` 新增 `datetime` 欄位：

```ts
export interface CommitItem {
  title: string;
  sha: string;
  project: string;
  url: string;
  datetime: string;  // ISO 8601, e.g. "2026-03-18T15:30:45+08:00"
}
```

#### Script 改動

| 檔案 | 改動 |
|------|------|
| `scripts/collect-gitlab-commits.js` | `filterAndMapCommits` 中繼物件新增 `datetime: c.committed_date` |
| `scripts/fetch-gitlab-commits.js` | 同上（共用邏輯） |
| `buildDashboardJSON()` | items push 時保留 `datetime` |

`committed_date` 是 GitLab API 原生提供的 ISO 8601 格式字串，直接保留不轉換。

#### UI 改動

CommitsView Commit 明細表：
- 現有欄位 `日期 | 專案 | 標題 | SHA`
- 改為 `時間 | 專案 | 標題 | SHA`
- `時間` 從 `item.datetime` 格式化為 `HH:MM`（日期已由 activeDate 確定）
- Tooltip 顯示完整 datetime
- `datetime` 缺失時顯示 `—`

#### Backfill

重新執行 `node scripts/fetch-gitlab-commits.js --date 2/23-3/18` 一次性補齊所有歷史 commits 的 datetime。

## 不做的事

- 不改 commit 分組邏輯（仍用 committed_date 轉 M/D 作為 key）
- 不改 consistency analysis 邏輯（不受 status/datetime 影響）
- 不在 TrendView/WeeklyView 顯示 commit 時間（只在 CommitsView 明細）
- 不儲存原始 Chat 訊息到本地（dailyUpdates 只 POST 到 Sheets）

## 測試計畫

- Parser unit tests: 驗證不同回覆情境產生正確 status
- backfill-status.js: 驗證 leave 匹配正確
- CommitItem datetime: 驗證 buildDashboardJSON 保留 datetime
- CommitsView: 驗證 HH:MM 格式化顯示
- 向後相容: 驗證無 status 欄位時 fallback 正確
- data-schema test: 更新 schema 驗證包含 status 和 datetime
