---
description: 驗證 public/raw_data.json 結構與內容一致性 — 跑 JSON parse + tests/data-schema.test.js + 跨檔 cross-check (gitlab-commits / task-analysis / plan-analysis 對齊). 觸發詞 'validate raw_data', '檢查 raw_data', '/validate-raw-data', '驗證資料'.
user_invocable: true
---

# Validate Raw Data

對 `public/raw_data.json` 與相關 JSON 做完整驗證 — 在手動 merge、`/sync` 後、或 deploy 前使用。

## When to Use

- 手動編輯 `public/raw_data.json` 後
- `/sync` pipeline 報錯時排查
- Apps Script POST 失敗時定位資料層問題
- Deploy 前 sanity check

## Workflow

### Step 1: JSON parse + 必要欄位

```bash
node -e "
const d = require('./public/raw_data.json');
const required = ['rawData', 'issues', 'leave'];
const missing = required.filter(k => !(k in d));
if (missing.length) { console.error('missing keys:', missing); process.exit(1); }
console.log('rawData dates:', Object.keys(d.rawData).length);
console.log('issues:', d.issues.length);
console.log('leave members:', Object.keys(d.leave || {}).length);
console.log('centers:', d.centers ? Object.keys(d.centers).length : 'none');
console.log('parentCenters:', d.parentCenters ? Object.keys(d.parentCenters).length : 'none');
console.log('validCodes:', d.validCodes ? Object.keys(d.validCodes).length : 'none');
"
```

Fail-fast：parse 錯或缺 `rawData / issues / leave` 直接停。

### Step 2: 跑 schema 測試

```bash
bun run test --run tests/data-schema.test.js
```

`tests/data-schema.test.js` 已涵蓋：
- `rawData[M/D][member]` 結構（`total / meeting / dev / items`）
- `M/D` date key 格式
- `issues[]` 含 `member / severity / text`
- `leave[member][]` 含 `start / end`
- `validCodes`、`centers`、`parentCenters` 一致性（如存在）

### Step 3: Cross-check 相關 JSON（選用）

如果 `gitlab-commits.json`、`task-analysis.json`、`plan-analysis.json` 存在，檢查 date 與 member 對齊：

```bash
node -e "
const raw = require('./public/raw_data.json');
const dates = new Set(Object.keys(raw.rawData));
const allMembers = new Set();
Object.values(raw.rawData).forEach(d => Object.keys(d).forEach(m => allMembers.add(m)));

['gitlab-commits', 'task-analysis', 'plan-analysis'].forEach(name => {
  try {
    const j = require('./public/' + name + '.json');
    const ds = j.commits ? Object.keys(j.commits)
            : j.warnings ? [...new Set(j.warnings.map(w => w.date))]
            : j.correlations ? [...new Set(j.correlations.map(c => c.date))]
            : [];
    const orphan = ds.filter(d => !dates.has(d));
    if (orphan.length) console.warn(name, 'has dates not in raw_data:', orphan);
    else console.log(name, '✓ date alignment OK');
  } catch (e) { console.log(name, 'skipped:', e.code || e.message); }
});
"
```

### Step 4: Report

成功 → 印 summary（date 數、issue 數、member 數），rc=0。
失敗 → 印第一個錯誤位置（date、member、欄位），rc=1，不修改任何檔案。

## 注意

- 這是 **read-only** skill，不寫檔
- 受 `.claude/settings.json` PreToolUse hook 保護的檔案不會被本 skill 觸碰
- 若 `data-schema.test.js` 失敗，請先 fix test 再 deploy；不要 `--bail` 或忽略
