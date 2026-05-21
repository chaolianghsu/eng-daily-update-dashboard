---
description: Safe wrapper for `bun run deploy:appscript` — pre-flight check (clean tree, tests green, raw_data valid) → build → diff sanity → clasp push → clasp deploy with timestamp. Use before deploying Apps Script changes. 觸發詞 'deploy appscript', '部署 apps script', '/appscript-deploy-check', '推 spreadsheet'.
user_invocable: true
---

# Appscript Deploy Check

`bun run deploy:appscript` 已經一條龍跑完 build + `clasp push` + `clasp deploy`，但少了**部署前的安全網**。本 skill 在執行前後加上 4 層 sanity check，避免把壞東西推到 production Spreadsheet。

## When to Use

- 對 `appscript/Code.gs` 或 `appscript/` 內任何檔案做修改後
- 對 `scripts/migrate-to-parent-centers.js` 之類影響 schema 的腳本做修改後
- 對 `src/` 影響 dashboard 內嵌頁面（Apps Script-served HTML）的修改後
- Periodic deploy（每週 / 月一次重新 push 最新 dashboard）

## Prerequisites

- `clasp` 在 PATH（`which clasp` 不空）
- `appscript/.clasp.json` 與 `appscript/appsscript.json` 存在（兩者均 gitignored）
- 已登入正確的 Google 帳號（`clasp login`）
- `package.json` 有 `deploy:appscript` script

## Workflow

### Step 1: Pre-flight checks（出錯就停）

```bash
# 1a. 工作樹乾淨（appscript/Code.gs 與 src/ 不能有未 commit 變更）
git diff --quiet -- appscript/Code.gs src/ scripts/ || { echo "❌ 有未 commit 變更 — 請先 commit 再 deploy"; git status --short -- appscript/Code.gs src/ scripts/; exit 1; }

# 1b. 在 main 分支（branch deploy 容易忘記 merge 回去）
test "$(git branch --show-current)" = "main" || { echo "❌ 不在 main 分支（目前 $(git branch --show-current)）— 請先切回 main"; exit 1; }

# 1c. tests 通過
bun run test 2>&1 | tail -5
# 預期最後一行: "Tests N passed"

# 1d. raw_data 結構有效
node -e "
const d = require('./public/raw_data.json');
const r = ['rawData', 'issues', 'leave'].filter(k => !(k in d));
if (r.length) { console.error('❌ raw_data.json 缺欄位:', r); process.exit(1); }
console.log('✓ raw_data.json OK');
"
```

若任一項失敗 → 報告並停。不要強行繼續。

### Step 2: Build

```bash
bun run build:appscript 2>&1 | tail -10
```

成功會在 `appscript/index.html` 產出新 build。

### Step 3: Diff sanity

```bash
# 對比上次 push 的內容
git diff HEAD -- appscript/index.html | head -50
ls -la appscript/index.html  # 確認檔案存在且非空
# 行數 sanity check — < 100 行通常是 build 失敗的徵兆
test "$(wc -l < appscript/index.html)" -gt 100 || { echo "❌ appscript/index.html 行數異常少"; exit 1; }
```

如果 diff 顯示完全不同的內容（例如所有 minified code 都變了），確認是預期的 Vite/bun 版本更新而非意外。

### Step 4: 跑 `deploy:appscript`

```bash
bun run deploy:appscript 2>&1 | tee /tmp/appscript-deploy-$(date +%s).log
```

這條會：
1. 再跑一次 `build:appscript`（idempotent，安全）
2. `cd appscript && clasp push` — 推送到 Apps Script project
3. `clasp deploy -i <DEPLOYMENT_ID> -d "$(date +%Y-%m-%d)"` — 建立新 version 並 deploy

**OUTPUT 解讀：**
- `Pushed X files.` — push OK
- `- 1.0.X @ <date>` — deploy 建立新 version
- 若看到 `Error: User has not granted the app...` — 請使用者跑 `clasp login` 重新授權

### Step 5: 驗證 deploy

```bash
# 列出最近的 deployments
cd appscript && clasp deployments | head -10
```

確認你剛 deploy 的版本在最上方（最新）。

## 失敗復原

| 情況 | 處置 |
|------|------|
| Step 1 任一檢查失敗 | 停手 — 修完未 commit 變更 / 切回 main / 修壞掉的 test 後重跑 |
| Step 2 build 失敗 | 看 vite 錯誤訊息；通常是 `src/` import 路徑壞掉 |
| Step 3 行數過少 | build 沒真的執行 — 刪 `appscript/index.html` 再跑 step 2 |
| Step 4 `clasp push` 失敗 | 多半是登入過期或 quota；跑 `clasp login` 重試 |
| Step 4 `clasp deploy` 失敗但 push 成功 | manual deploy: `cd appscript && clasp deploy -i AKfycbxMfzEiZoAq5igmL69qN711mCrpX9Mv0vjnxb1IiEqpkC0h_ZVR2me2SNlX82YvNEGp -d "manual-$(date +%Y-%m-%d)"` |

## 注意

- **這是有副作用的 skill**：step 4 會把當前 build 推到 production Apps Script 並 deploy
- 受 PreToolUse hook 保護的 `appscript/index.html` 是預期會被 `bun run build:appscript` 改寫的 — build script 走 Node 而非 agent edit，hook 不擋
- Deployment ID 寫死在 package.json `deploy:appscript` 裡，要換 deployment 直接改 script
