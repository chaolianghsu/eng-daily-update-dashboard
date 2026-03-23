# Commits 整合設計 — WeeklyView 升級 + TrendView 表格 + CommitsView 清理

## 問題

1. 一致性檢查 heatmap 放在 CommitsView（date-specific view），但它是跨日期的 team health 總覽，使用者不知道它不跟日期連動
2. TrendView 和 WeeklyView 缺少 commits 資料整合，無法在這些彙整型 view 中看到完整的工時 × commits 表現

## 設計決策

- **一致性 heatmap 搬到 WeeklyView** — WeeklyView 的定位是「期間彙整」，語義吻合
- **WeeklyView 全面升級** — 表格加 commits 欄位、長條圖加 commit overlay
- **TrendView 表格升級** — 彙整表加 commits 欄位（圖表層已有 commit bars，不需改動）
- **CommitsView 移除 heatmap** — 保持純粹的 date-specific 內容

## 變更明細

### 1. WeeklyView

#### 1a. useWeeklySummary hook 擴充

接收新參數 `commitData` 和 `leave`。為每個成員計算：
- `commitTotal`: 期間 commit 總數（從 `commitData.commits` 各日期加總）
- `commitAvg`: commits / 有 commit 的天數
- `consistency`: 一致性分布物件 `{ ok: number, warn: number, red: number }` — 從 `commitData.analysis` 統計該成員在所有日期的 ✅/⚠️/🔴 數量

#### 1b. 彙整表新增欄位

在現有表格的「穩定度」和「趨勢」之間插入三欄：

| 欄位 | 來源 | 格式 |
|------|------|------|
| Commits | `commitTotal` | teal 粗體數字，0 顯示為 `—` |
| Commit 日均 | `commitAvg` | teal 數字，小數一位 |
| 一致性 | `consistency` | compact emoji: `✅5 ⚠️1` |

用 teal 色 left-border (`2px solid #164e63`) 視覺分隔工時區和 commits 區。

表頭的 Commits/日均/一致性 用 `COLORS.teal` 標示。

#### 1c. 長條圖 Commits overlay

在現有水平堆疊 BarChart 中，為每條 bar 加一個 teal 色標記顯示該成員的 commit 總數：
- 使用 Recharts `LabelList` 或 custom label 在 bar 右側顯示 teal 數字
- 不新增額外 Bar — 避免視覺過於複雜

#### 1d. 一致性 Heatmap

從 CommitsView 搬來，作為 WeeklyView 的第三個 CardPanel：
- Title 改為 `一致性總覽（全期間）`
- 需要新增 props: `commitData`, `leave`, `dates`, `activeDate`, `onDateSelect`, `dayLabels`, `dailyDates`
- Heatmap 內的日期點擊行為改為：切換到 Commits tab 並選中該日期（透過 callback）

### 2. TrendView

#### 2a. useTrendData hook 擴充

在現有的 `weekGroups` 輸出中，為每個 week group 額外計算：
- `commitTotal`: 該週 commit 總數
- `commitAvg`: 日均 commits
- `consistencyPct`: ✅ 狀態佔比（百分比）

#### 2b. 彙整表新增欄位

在週/日彙整表（TrendView 底部的 table）中新增三欄：

| 欄位 | 來源 | 格式 |
|------|------|------|
| Commits | `commitTotal` | teal 粗體 |
| 日均 | `commitAvg` | teal，小數一位 |
| 一致 ✅ | `consistencyPct` | 綠色百分比 |

同樣用 teal left-border 分隔。

### 3. CommitsView

- **移除**一致性 heatmap 區塊（整個 `CardPanel title="一致性檢查（每日明細）"` 及其內容）
- 保留：date selector、scatter chart、task warnings（date-filtered）、project participation、commit detail

### 4. App.tsx

WeeklyView 需要新增 props 傳遞：
- `commitData` — 已在 App.tsx 中存在，目前未傳給 WeeklyView
- `leave` — 同上
- `dates` — 已傳（用於 heatmap）
- `activeDate`, `onDateSelect`, `dailyDates`, `dayLabels` — heatmap 點擊互動需要

注意：heatmap 的日期點擊在 WeeklyView 中應切換 view 到 commits + 設定 activeDate。需要新增一個 callback：
```ts
onDateSelectAndSwitchToCommits: (date: string) => void
```
App.tsx 中實作為 `(d) => { setSelectedDate(d); setView('commits'); }`

## 不做的事

- TrendView 趨勢圖本身不改 — 已有 commit bars 和 per-member commit lines
- 不新增獨立 tab — WeeklyView 作為 team health 總覽足夠
- 不在 DailyView 加 commits — DailyView 專注單日工時分佈
- 不把一致性 heatmap 做成可選日期範圍 — 它用 `commitData.analysis` 的所有日期

## 測試計畫

- `useWeeklySummary` 新增欄位的 unit tests（commitTotal, commitAvg, consistency 計算）
- `useTrendData` weekGroups 新增欄位的 unit tests
- WeeklyView component test — 驗證 commits 欄位渲染
- TrendView component test — 驗證 commits 欄位渲染
- CommitsView component test — 驗證 heatmap 已移除
- 手動驗證：WeeklyView heatmap 點擊 → 切換到 Commits tab
