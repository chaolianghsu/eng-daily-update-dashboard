# Tab 重構 + 共用日期導航設計

**日期**: 2026-03-31
**分支**: `refactor/tab-restructure-shared-date-nav`

## 目標

1. 將 5 個頂層 tab 整合為 3 個，減少認知負擔和手機上的擁擠感
2. 抽取共用日期/週導航元件，消除 3 處重複的日期選擇 UI
3. 精簡日期導航的垂直空間（從 ~80px 降至 ~42px）
4. 統一全 dashboard 的 pill/button 視覺風格

## 設計決策

### 1. Tab 結構：5 → 3

| 新 Tab | 內容 | 原 Tab |
|--------|------|--------|
| 📅 每日詳情 | 工時圖表 + Commits + 規劃追蹤（sub-view 切換） | 每日工時 + Commits + 規劃追蹤 |
| 📈 趨勢 | 趨勢比較（不變） | 趨勢比較 |
| 📋 週報 | 週統計（不變） | 週統計 |

- 「Commits」和「規劃追蹤」從頂層 tab 降級為「每日詳情」的 sub-view
- StatusOverview 維持在 tab 列上方，不受 tab 切換影響（現有行為不變）

### 2. Sub-view 切換：Pill + Badge

「每日詳情」tab 內用 pill 切換列在三個 sub-view 間切換：

```
[📊 工時] [🔀 Commits 12] [📋 規劃 2]
```

- 選中的 pill 用 `background: #334155; color: #e2e8f0` 高亮
- 未選中的 Commits pill 顯示 teal badge（當天 commit 總數）
- 未選中的規劃 pill 顯示 purple badge（當天 spec commit 數）
- Badge 數字從 `commitData` 和 `planAnalysisData` 對 `activeDate` 動態計算
- 如果 `commitData` 為 null，隱藏 Commits pill；如果 `planAnalysisData` 為 null 或無 specs，隱藏規劃 pill
- 如果當前 `subView` 對應的 pill 被隱藏（例如 commitData 載入失敗），自動 fallback 到 "hours"
- 切換 sub-view 時，日期導航狀態保持不變

### 3. 共用日期導航：精簡單行式

新增 `<DateNavigator>` 元件，取代 DailyView 和 CommitsView 中的重複實作：

```
◀ [24一][25二][26三][27四][28五] ▶ | W13 ▾
```

**佈局**：
- 單行 flex 容器，背景 `#1e293b`，圓角 10px，padding 6px 10px
- 左右箭頭 `◀` `▶` 切換前後週
- 中間 5 個日期方塊，flex: 1 均分寬度
- 日期方塊上方數字大 (13px, bold)，下方星期小 (9px)
- 選中日期：`background: #06b6d4; color: #0f172a`
- 右側分隔線 `|` + `W13 ▾` 按鈕開啟週別下拉選單

**週別下拉選單**：
- 點擊 `W13 ▾` 展開，列出所有週別
- 選單頂部增加「本週」「上週」快捷項目（取代原本的獨立按鈕）
- 當前週別高亮顯示
- 選擇後自動關閉

**Props 介面**：
```typescript
interface DateNavigatorProps {
  dates: string[];              // 當週日期列表
  activeDate: string;           // 目前選中的日期
  onDateSelect: (d: string) => void;
  dayLabels: Record<string, string>;  // 日期→星期對照
  // 週導航 (from useWeekNavigator)
  weeks: Week[];
  weekIndex: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSelectWeek: (i: number) => void;
}
```

### 4. 視覺統一

趨勢 tab 的範圍選擇器（1週/2週/1月/全部）和成員篩選按鈕，更新為與 sub-view pill 同系列的樣式：
- 容器：`background: #1e293b; border-radius: 8px; padding: 3px`
- 選中：`background: #334155; color: #e2e8f0`
- 未選中：`color: #64748b`

功能邏輯不變，只更新視覺樣式。

## 元件架構

### 新增元件

| 元件 | 檔案 | 職責 |
|------|------|------|
| `DateNavigator` | `src/components/DateNavigator.tsx` | 共用日期/週導航，單行精簡式 |
| `SubViewPills` | `src/components/SubViewPills.tsx` | 「每日詳情」的 sub-view 切換 + badge |
| `PillGroup` | `src/components/PillGroup.tsx` | 通用 pill 容器，趨勢範圍選擇器和成員篩選也用 |

### 修改檔案

| 檔案 | 變更 |
|------|------|
| `App.tsx` | tab 從 5 改 3，新增 `subView` state，「每日詳情」渲染 DateNavigator + SubViewPills + 對應 sub-view |
| `DailyView.tsx` | 移除週導航和日期選擇 UI（~100 行），只保留圖表和資料內容 |
| `CommitsView.tsx` | 移除日期按鈕列（~15 行），只保留散佈圖和資料內容 |
| `PlanSpecView.tsx` | 移除標題中的 activeDate 顯示（由上層 DateNavigator 提供） |
| `TrendView.tsx` | 範圍選擇器改用 PillGroup 元件 |
| `components.tsx` | 移除 `tabStyle` 如果不再被使用；或更新為新風格 |

### 不變檔案

| 檔案 | 理由 |
|------|------|
| `useWeekNavigator.ts` | hook 邏輯不變，只是呼叫方從 DailyView 移到 App |
| `useDailyBarData.ts` | 不變 |
| `useTrendData.ts` | 不變 |
| `useWeeklySummary.ts` | 不變 |
| `useAllIssues.ts` | 不變 |
| `StatusOverview.tsx` | 不變，維持在 tab 列上方 |

### 小幅修改檔案

| 檔案 | 變更 |
|------|------|
| `WeeklyView.tsx` | `onDateSelectAndSwitchToCommits` prop 改為通用的 `onDateSelect` + 由 App 層處理 sub-view 切換 |

## State 管理

App.tsx 的 state 變更：

```typescript
// 現有
const [view, setView] = useState("daily");  // → 改為 "detail" | "trend" | "weekly"

// 新增
const [subView, setSubView] = useState<"hours" | "commits" | "planspec">("hours");
```

- `selectedDate` 和 `weekNav` 維持在 App 層級，由 DateNavigator 元件消費
- 切換主 tab 時不重設 `subView`（回到「每日詳情」時保留上次的 sub-view）
- 切換主 tab 時不重設 `selectedDate`（日期在所有 view 間共享）

## 移除項目

- DailyView 中的週導航 UI（~87 行 inline styles + event handlers）
- DailyView 中的日期按鈕列（~13 行）
- CommitsView 中的日期按鈕列（~15 行）
- App.tsx 中的 `dateSelectAndSwitchToCommits` 函數（WeeklyView 的日期點擊改為設定 `subView="commits"` + `selectedDate`）
- 獨立的「本週」「上週」按鈕

## 測試策略

### 單元測試（Vitest + jsdom）

- `DateNavigator`：渲染所有日期、active 狀態高亮、點擊日期觸發 onDateSelect、箭頭 disabled 狀態、下拉選單開合
- `SubViewPills`：pill 切換觸發 callback、badge 數字正確顯示、commitData 為 null 時隱藏 Commits pill、subView fallback 邏輯
- `PillGroup`：通用渲染、選中狀態、點擊事件
- 現有 hook 測試不需修改
- 現有 view component 測試需更新 props（移除日期導航相關 props）

### Playwright E2E 測試

- **Tab 切換**：點擊 3 個主 tab 確認內容正確切換
- **Sub-view 切換**：在「每日詳情」內切換工時 → Commits → 規劃，確認內容更新
- **日期保留**：選擇日期 3/25 → 切換到 Commits sub-view → 確認仍在 3/25
- **週導航**：點擊 ◀ ▶ 確認日期列更新、W▾ 下拉選單可切換週別
- **Badge 數字**：確認 Commits badge 顯示正確的 commit 數量
- **手機 RWD**：viewport 768px 以下確認 3 tab 不換行、日期導航可用
