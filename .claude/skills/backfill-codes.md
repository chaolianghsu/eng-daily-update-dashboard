---
description: 一次性回補歷史 daily update 工項的 [CODE] tag — 用 recommend-codes 推薦 → preview → 確認 → apply → commit + push + Sheets POST. 用於降低 dashboard 「未分類率」KPI. 觸發詞 '回補 code', '/backfill-codes', '降低未分類率'.
user_invocable: true
---

# Backfill Codes

一次性歷史回補 `public/raw_data.json` 中 `items[].code === null` 的工項。先 preview，使用者確認後才寫入、commit、push、POST Sheets。

設計目標：把 dashboard 的「未分類率」KPI 從 ~64.9% 降到 < 20%（target）。Lane C 的 `scripts/recommend-codes.js` 已可推薦 89.8% 的 null items；此 skill 是 apply 那一步的安全互動 wrapper。

## Prerequisites

- `public/raw_data.json` 存在，含 `centers` 與 `validCodes`
- `public/gitlab-commits.json` 存在（commit-based 推薦會用）
- Git remote 已設定
- `scripts/recommend-codes.js` + `scripts/apply-code-recommendations.js` 存在

## Workflow

### Step 1: 產生推薦

```bash
node scripts/recommend-codes.js > /tmp/recommendations.json 2>/tmp/recommend-stderr.txt
```

讀取 summary：

```bash
node -e "const d=require('/tmp/recommendations.json'); console.log(JSON.stringify(d.summary, null, 2))"
```

顯示給使用者（範例）：

```
📊 Recommendation summary
  總 items 掃描：174
  null code items：147
  可推薦：132 (89.8% coverage)
  無法推薦：15

  By source: rule 71, commit 45, meeting 16
  By department: 工程 147

  Top 5 codes by count:
    KEYPO: 26
    KEYDERS: 18
    MEETING: 16
    LSR: 15
    KEYKYC: 13
```

如果 `summary.recommended === 0`：顯示「沒有可推薦的 items（可能已全部 coded）」，乾淨退出，不做任何修改。

### Step 2: Sample changes preview（每種 source 前 10 個）

```bash
node -e '
const d=require("/tmp/recommendations.json");
const groups={rule:[],meeting:[],commit:[]};
for(const r of d.recommendations){if(groups[r.source])groups[r.source].push(r)}
for(const [src,arr] of Object.entries(groups)){
  console.log(`\n[${src}] ${arr.length} items, showing first 10:`);
  for(const r of arr.slice(0,10)){
    console.log(`  ${r.date} ${r.member} — "${(r.task||"").slice(0,50)}" → ${r.recommendedCode}`);
  }
}
'
```

顯示「無法推薦」的 examples 讓 user 看 failure mode：

```bash
node -e '
const d=require("/tmp/recommendations.json");
const none=d.recommendations.filter(r=>r.source==="none");
console.log(`\n⚠️ 未推薦 (${none.length} items 留 null):`);
for(const r of none.slice(0,10)){
  console.log(`  ${r.date} ${r.member} — "${(r.task||"").slice(0,60)}"`);
}
'
```

備註：家輝的 IDC/機房工作目前是已知 gap（validCodes 沒有 IDC keyword）。可以提一句「known gap, future AI lane could improve」。

### Step 3: Confirmation gate

用 `AskUserQuestion`（多選，不要 confirmation toggle）問：

> 回補 N 個 [CODE] tag 到 `public/raw_data.json`，會 commit + push + POST Sheets。要怎麼進行？
>
> A) 全部套用（N changes — rule + meeting + commit）
> B) 只套用 high confidence（rule + meeting，~約 M changes）
> C) 預覽完整 diff 再決定
> D) 取消

實際 N、M 從 `summary.bySource` 算：M = `bySource.rule + bySource.meeting`。

#### 處理選項

- **D (取消)**：乾淨退出，不修改任何檔案。
- **C (預覽 diff)**：
  ```bash
  node scripts/apply-code-recommendations.js \
    --dry-run \
    --recommendations /tmp/recommendations.json \
    --rawdata public/raw_data.json \
    > /tmp/dryrun-rawdata.json 2>/tmp/dryrun-err.txt
  diff public/raw_data.json /tmp/dryrun-rawdata.json > /tmp/backfill-diff.txt
  head -50 /tmp/backfill-diff.txt
  echo "..."
  echo "Full diff at /tmp/backfill-diff.txt ($(wc -l < /tmp/backfill-diff.txt) lines)"
  ```
  顯示 diff 前 50 行，然後重新問同一題，但移除 C 選項（A/B/D only）。
- **A (全部)** → 走 Step 4，不加 filter flag。
- **B (high only)** → 走 Step 4，加 `--filter-confidence high`。
  注意：`meeting` source 是 `confidence: medium`，所以 `--filter-confidence high` 只會包 rule。如果使用者意思是「rule + meeting」要走 high confidence，改用兩次 apply 是 overkill；建議直接告訴使用者 B 等於「只 rule」(~71 changes)，並在 Step 3 的選項文字裡誠實標示。

→ 改寫 Step 3 選項：
> B) 只套用 rule (high confidence) (~71 changes)

### Step 4: Apply

```bash
# A 選項
node scripts/apply-code-recommendations.js \
  --recommendations /tmp/recommendations.json \
  --rawdata public/raw_data.json \
  2> /tmp/apply-stderr.txt

# B 選項（high only = rule only）
node scripts/apply-code-recommendations.js \
  --recommendations /tmp/recommendations.json \
  --rawdata public/raw_data.json \
  --filter-confidence high \
  2> /tmp/apply-stderr.txt
```

顯示 stderr summary（已含 by code, by source, applied count）。

### Step 5: Validate

```bash
bun run test 2>&1 | tail -5
```

**Test failure policy:**
- 預期 3-4 pre-existing failures (`plan-analysis-schema`, `backfill.test.js × 2`, `llm-reparse-failures`) — 不用修，但確認**沒有新的 failure**。
- 如果出現新 failure：**停下不要 commit**，告訴使用者 `git diff public/raw_data.json` 並手動 rollback (`git restore public/raw_data.json`)。

### Step 6: Commit + push

```bash
APPLIED=$(grep "applied:" /tmp/apply-stderr.txt | awk '{print $2}')
BEFORE_PCT="64.9%"
# 估算 after：assume 27 already-coded + APPLIED out of 174
AFTER_PCT=$(node -e "const a=parseInt(process.argv[1]); const total=174; const before=27; console.log(((total-before-a)/total*100).toFixed(1)+'%')" $APPLIED)

git add public/raw_data.json
git commit -m "Backfill [CODE] tags for historical work items

Applied $APPLIED recommendations via recommend-codes +
apply-code-recommendations. Reduced 未分類率 from $BEFORE_PCT to $AFTER_PCT.

Source: scripts/recommend-codes.js + scripts/apply-code-recommendations.js
Recommendations: /tmp/recommendations.json (preview reviewed)"
git push
```

### Step 7: POST to Apps Script

```bash
REDIRECT_URL=$(curl -s -o /dev/null -w "%{redirect_url}" -X POST \
  -H "Content-Type: application/json" \
  -d @public/raw_data.json \
  "https://script.google.com/macros/s/AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp/exec" 2>/dev/null)
curl -s "$REDIRECT_URL"
```

Expected: `{"status":"ok","dates":N}`

如果 POST 失敗：commit + push 已成功，告訴使用者可以稍後跑 `/sync` 重 POST。

### Step 8: Summary

```
✅ Backfill 完成
  套用：$APPLIED changes
  之前未分類率：64.9%
  之後未分類率：~$AFTER_PCT（估算）
  Commit: $(git rev-parse --short HEAD)
  Sheets: updated
  Dashboard: https://chaolianghsu.github.io/eng-daily-update-dashboard/
```

### Step 9: 選擇性 Chat 通知

顯示 preview 給使用者，問「要發送通知嗎？」**只有明確說好才送**（見 memory：chat notifications require explicit user confirmation）。

格式：

```
📊 [CODE] tag 回補完成
適用：$APPLIED items (rule $RULE, commit $COMMIT, meeting $MEETING)
未分類率：64.9% → $AFTER_PCT
📈 Dashboard: https://chaolianghsu.github.io/eng-daily-update-dashboard/
```

確認後送到 `chat-config.json` 的工程 space（`spaces/AAQAQhmoRAk`），用 `mcp__gws__chat_spaces_messages_create`。

## Gotchas / 錯誤處理

- **Recommender 空結果**：`summary.recommended === 0` → 直接停，顯示「沒有可推薦的 items」。
- **使用者取消 (D)**：完全不修改任何檔案 / 不 commit / 不 POST。
- **Apply 後測試失敗**：**停下不要 commit**。提示使用者跑 `git diff public/raw_data.json` 查看，並 `git restore public/raw_data.json` 手動 rollback。
- **POST 失敗但 commit 成功**：可以容忍。告訴使用者稍後跑 `/sync` 會自動 re-POST。
- **重跑 idempotent**：`applyRecommendations` 內部 `code != null` 防呆，重跑會自動跳過已 coded items（在 stderr summary 看 `skipped (existing)` 數字）。
- **`--filter-confidence high` ≠ "rule + meeting"**：`meeting` source 標為 `confidence: medium`，所以 high-only 只有 rule。Step 3 選項文字要誠實標示。
- **`AskUserQuestion` 不可自動推進**：Step 3 必須等使用者明確選 A/B/C/D，禁止假設 default。

## Notes

- `scripts/apply-code-recommendations.js` 是 pure CommonJS，純函數可 import 測試（見 `tests/unit/apply-code-recommendations.test.js`，18 tests）。
- 與 `/sync` 工作流分離：sync 是日常增量；backfill 是一次性歷史回補。預期 merge 後跑一次即可。
- 重跑時 `--filter-source` 可以用來只補某一類（例：第一次只跑 `rule`，看一週後 commit / meeting 再分批）。
