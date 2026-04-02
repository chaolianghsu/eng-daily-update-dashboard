# Team Health Intelligence — Design Spec

## Purpose

讓 engineering lead 從「每天逐一檢查每個人」變成「只看例外」，並在 1-on-1 前 30 秒看完某人近況。

## Two Use Cases, Two UI Surfaces

| 場景 | 頻率 | UI 位置 |
|------|------|---------|
| 每天快速掃描異常 | 每天 | StatusOverview（首屏，零導航） |
| 1-on-1 前看某人近況 | 每週 | 新「👤 成員」tab |

---

## 1. 異常偵測引擎

### 混合規則：固定閾值 + 滾動基線

**固定閾值（硬底線）** — 無條件觸發，使用現有 `THRESHOLDS` + 新增規則：

| 規則 | 觸發條件 | 嚴重度 |
|------|----------|--------|
| 極低工時 | 單日 total < 4h | 🔴 |
| 極高工時 | 單日 total > 11h | 🔴 |
| 連續低工時 | 連續 ≥ 3 天 total < THRESHOLDS.low (6.5h) | 🔴 |
| 會議過重 | 會議佔比 > 60% | 🟡 |
| 連續未回報 | 連續 ≥ 2 天未回報（排除休假） | 🟡 |

**滾動基線（個人趨勢）** — 根據個人歷史動態計算：

- **窗口**：近 4 週（~20 工作天），排除休假日
- **基線**：個人 median（中位數）
- **偏差**：MAD × 1.4826（換算等效 σ）
- **觸發**：偏離 > 2 × adjusted MAD
- **新人處理**：資料不足 20 天時，fallback 到固定閾值

偵測的異常類型：
- 工時突降（近 3 天平均 vs 基線）
- 工時突升（可能燃盡風險）
- 會議比例突升（week-on-week 比較）
- Commit 頻率突降（近 7 天 vs 前 7 天）

### 資料來源

- 工時：`rawData[date][member].total / .meeting / .dev`
- Commits：`commitData.commits[date][member].count`
- 一致性：`commitData.analysis[date][member].status`
- 休假：`leave[member][]`
- 任務警告：`taskAnalysisData.warnings[]`

---

## 2. StatusOverview 強化

### 改動方式

在現有 attention cards 中混入趨勢異常，加 badge 區分來源。

**現有 card 結構不變**：
```
🔴 日銜 超時工作 11.5hr
```

**新增趨勢 card**（同結構 + badge）：
```
🔴 日銜 連續低工時 (3天)  [趨勢]
🟡 建志 會議佔比偏高       [趨勢]
```

### Badge 設計

- 固定閾值觸發：不加 badge（維持現狀）
- 滾動基線觸發：加粉紅色小 badge `趨勢`（background: `#f472b644`, color: `#f472b6`）

### 排序邏輯

所有 attention cards（不論來源）統一按嚴重度排序：🔴 → 🟡 → 🟠

### 實作影響

- 修改 `useAllIssues` hook：整合趨勢異常為 `Issue[]`，新增 `source: "threshold" | "trend"` 欄位
- 修改 `StatusOverview.tsx`：根據 `source` 欄位決定是否顯示 badge
- `Issue` type 新增可選 `source` 欄位

---

## 3. 成員 Profile Tab（👤 成員）

### Tab 位置

新增第四個頂層 tab，排在「📋 週報」之後：
```
📅 每日詳情 | 📈 趨勢 | 📋 週報 | 👤 成員
```

### 成員選擇列

- PillGroup 元件（復用現有）列出所有成員
- 有異常的成員在名字旁顯示嚴重度 emoji（🔴/🟡）
- 預設選中第一個有異常的成員；若全員正常，選第一人
- 點擊切換

### 警報 Banner

- 選中的成員如有異常，顯示在選擇列下方
- 復用現有 attention card 樣式
- 無異常時不顯示

### 四張資訊卡片（Responsive 2x2 Grid）

**佈局**：
- 桌面（> 768px）：`grid-template-columns: 1fr 1fr`（2x2）
- 手機（≤ 768px）：`grid-template-columns: 1fr`（單欄堆疊）
- 使用現有 `isMobile` state 切換

**Card 1: 30 天工時曲線**
- Recharts BarChart，每天一根 bar
- bar 顏色依 status 變化（正常 blue、warning yellow、danger red）
- 基線以虛線標示
- 下方摘要：基線值、近 7 天平均、會議佔比

**Card 2: 一致性 Timeline**
- 4 週 × 5 天的 heatmap grid（7 列 × 4 行）
- 每格顏色：✅ green、⚠️ yellow、🔴 red、無資料 gray
- 下方摘要：✅/⚠️/🔴 計數、一致率百分比
- 資料來源：`commitData.analysis[date][member].status`

**Card 3: 專案分布（30 天）**
- Stacked bar（單條橫向百分比 bar）顯示各 repo 佔比
- 下方 legend 列出前 4 個專案 + 百分比
- 摘要：Total commits、近 7 天 vs 前 7 天
- 資料來源：`commitData.commits[date][member].projects` + `.items`

**Card 4: 會議比例 & 任務警告**
- 上半：4 週的會議佔比 bar chart（每週一根），超過閾值的 bar 變色
- 下半：此成員的任務警告列表（從 `taskAnalysisData.warnings` 篩選）
- 最多顯示最近 5 筆

---

## 4. 新增 Hook 架構

### `useHealthAlerts(rawData, members, dates, commitData, leave, taskAnalysisData)`

**職責**：計算所有成員的健康警報

**回傳值**：
```ts
interface HealthAlert {
  member: string;
  severity: "🔴" | "🟡" | "🟠";
  text: string;
  source: "threshold" | "trend";
  type: "low_hours" | "high_hours" | "consecutive_low" | "meeting_heavy" |
        "unreported" | "hours_drop" | "hours_spike" | "meeting_spike" | "commit_drop";
}

// return: HealthAlert[]
```

**內部邏輯**：
1. 遍歷每個 member
2. 跑固定閾值規則（基於 activeDate 附近的資料）
3. 跑滾動基線規則（基於近 4 週資料）
4. 排除休假日
5. 合併、去重、按嚴重度排序

### `useMemberProfile(rawData, member, dates, commitData, leave, taskAnalysisData)`

**職責**：計算單一成員的 Profile 資料

**回傳值**：
```ts
interface MemberProfile {
  // 工時曲線
  hoursTrend: Array<{ date: string; total: number; meeting: number; dev: number; status: "normal" | "warning" | "danger" }>;
  baseline: number | null;      // median
  recentAvg: number | null;     // 近 7 天平均
  meetingPct: number | null;    // 近 7 天會議佔比

  // 一致性
  consistencyGrid: Array<{ date: string; status: "✅" | "⚠️" | "🔴" | null }>;
  consistencyRate: number;      // ✅ / total 百分比

  // 專案分布
  projectDistribution: Array<{ project: string; count: number; pct: number }>;
  totalCommits: number;
  recentCommits: number;        // 近 7 天
  prevCommits: number;          // 前 7 天

  // 會議比例週趨勢
  weeklyMeetingPct: Array<{ week: string; pct: number }>;

  // 任務警告
  taskWarnings: Array<{ date: string; severity: string; type: string; task: string; reasoning: string }>;
}
```

---

## 5. 新增元件

### `MemberView.tsx`（新 view）

- Props: `rawData, members, memberColors, dates, commitData, leave, taskAnalysisData`
- 內部 state: `selectedMember`
- 使用 `useMemberProfile` hook 取得資料
- 使用 `useHealthAlerts` 取得警報（篩選當前成員）
- 4 張卡片各自是內部 sub-component（不需要獨立檔案，除非超過 ~100 行）

### App.tsx 修改

- 新增 `view` state option: `"member"`
- 新增 tab button: `{ key: "member", label: "👤 成員" }`
- 在 `view === "member"` 時 render `<MemberView />`

### StatusOverview.tsx 修改

- 接收 `healthAlerts` prop（從 `useHealthAlerts` 取得）
- 合併 `healthAlerts` 到現有 `attentionIssues`
- 根據 `source` 欄位決定是否顯示「趨勢」badge

---

## 6. 測試策略

### Unit Tests

- `useHealthAlerts.test.ts`：固定閾值規則、滾動基線計算、休假排除、新人 fallback
- `useMemberProfile.test.ts`：工時曲線計算、一致性 grid、專案分布聚合、會議比例

### Component Tests

- `MemberView.test.tsx`：成員切換、警報 banner 顯示/隱藏、responsive 格狀切換
- `StatusOverview.test.tsx`（擴充）：趨勢 badge 顯示

### E2E Tests

- 成員 tab 切換、成員選擇、卡片渲染
- StatusOverview 趨勢 badge 出現

---

## 7. 不做的事

- 不做排程自動同步（獨立 P0，另開 spec）
- 不做歷史警報持久化（警報每次 render 即時計算，不存 JSON）
- 不做 notification（Chat/email 推送）
- 不做自訂閾值 UI（先用 constants.ts 硬編碼）
