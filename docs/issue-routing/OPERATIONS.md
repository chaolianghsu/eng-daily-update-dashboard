# Issue Routing — Operations Runbook

> Audience: on-call / 工程主管
> 配套文件: [`README.md`](./README.md)

事件應對以「症狀 → 診斷 → 修復」三段式描述。碰到狀況先找對應 section,照著指令跑,大多能 10 分鐘內恢復。

---

## Incidents

### 1. Chat posts stopped appearing

**症狀:** 有新 issue 進 GitLab,但 daily-update space 沒看到 card。

**診斷:**

```bash
# 1. Cron 有跑嗎?
grep run-issue-routing /var/log/syslog | tail -20
# or
grep run-issue-routing /var/log/issue-routing.log | tail -20

# 2. LLM call 有錯嗎?
sqlite3 db/issue-routing.sqlite \
  "SELECT issue_uid, post_failures, status FROM issue_state WHERE post_failures > 0;"

# 3. Anthropic API key 還能用嗎?
curl -sS -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  https://api.anthropic.com/v1/models | head -20

# 4. Chat config 有效嗎?
# 驗 spaceId 可存取、token 沒過期(手動丟一則測試訊息)
```

**修復:**

- Cron 沒跑 → 確認 crontab 還在、host 時間正確、`run-issue-routing.sh` 有執行權限
- LLM 401 → rotate `ANTHROPIC_API_KEY`
- Chat 403 → 重新授權 Chat bot,更新 `chat-config.json` token
- `post_failures >= 5` 的 issue state 會被標成 `failed`,需手動 reset:`UPDATE issue_state SET status='open', post_failures=0 WHERE issue_uid='<uid>';`

---

### 2. Chat posts appearing but wrong repo suggestion

**症狀:** System 有貼 card,但 `建議 repos` 區塊列的 repo 明顯不對。

**診斷:**

```bash
# 1. 這個 label 在 config 裡嗎?
grep -A 3 "^  <LABEL>:" config/label-routing.yaml

# 2. 看 issue 實際 label → expected repo 的對照
#   打開 GitLab issue,對照 config/label-routing.yaml 的 primary_group 與 known_exceptions
```

**修復:**

- 若 label 不在 config:新增該 label(見 README §6)
- 若 label 在 config 但路由對象就是錯:
  - 單一 issue → 請 IC 按 Edit 改正
  - 反覆發生 → 開 PR 加 `known_exception`
- 若 confidence 本來就 < 0.5:prompt 可能需 tuning,先跑 eval suite 看哪幾題 regress

---

### 3. Approval button fails

**症狀:** IC 按 Approve / Edit / Dismiss,card 報錯或沒動。

**診斷:**

```bash
# 1. Webhook server 還活著嗎?
curl -fsS localhost:3099/health
# TODO: /health endpoint 若尚未實作,先跑 `systemctl status issue-routing-webhook`
#       或直接 netstat -tlnp | grep 3099

# 2. INTERNAL_TOKEN 對得上嗎?
#   Apps Script → Project Settings → Script Properties: ISSUE_ROUTING_INTERNAL_TOKEN
#   Host env: echo "$INTERNAL_TOKEN"
#   兩者必須完全一致

# 3. GitLab PAT 還能用嗎?
curl -fsS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" https://biglab.buygta.today/api/v4/user
```

**修復:**

- Webhook server 掛了 → `systemctl restart issue-routing-webhook`
- Token 不一致 → 以 host env 為準,更新 Apps Script Script Properties
- PAT 401/403 → 申請新 PAT(scope: `api`),更新 `gitlab-config.json`

---

### 4. Too many false positives / IC dismissing often

**症狀:** IC 反映「按 Dismiss 的比 Approve 還多」或 dashboard 看到 dismissed 比例異常高。

**診斷:**

```bash
# Confidence 分布
sqlite3 db/issue-routing.sqlite "
  SELECT ROUND(json_extract(last_analysis_json, '\$.confidence'), 1) AS conf,
         COUNT(*)
  FROM issue_state
  WHERE last_analysis_json IS NOT NULL
  GROUP BY conf
  ORDER BY conf;
"

# Approval 比例
sqlite3 db/issue-routing.sqlite \
  "SELECT approval_status, COUNT(*) FROM issue_state GROUP BY 1;"
```

**修復:**

- 多數 confidence < 0.6 → prompt 需調整,跑 `bun run issue-routing:eval` 找 regression,改 `lib/llm/phase1-routing.mjs` 的 prompt,再跑 eval 確認 ≥ 18/20 pass 才 merge
- Dismiss 集中在某 label → 開 PR 加 `known_exception` 或調整 `primary_group`
- 近期新 repo 但 label 沒加 → 更新 `config/label-routing.yaml` 的 `known_exceptions`

---

### 5. Approval webhook returning 500

**症狀:** Apps Script 把請求送到 webhook,但 response 是 500。

**診斷:**

```bash
# 1. Webhook 的 log
journalctl -u issue-routing-webhook -n 100 --no-pager

# 2. State DB lock 住了嗎?
sqlite3 db/issue-routing.sqlite "PRAGMA integrity_check;"
ls -la db/issue-routing.sqlite-wal db/issue-routing.sqlite-shm

# 3. GitLab PAT scope 還夠嗎?
curl -fsS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  https://biglab.buygta.today/api/v4/personal_access_tokens/self
# 看 "scopes" 是否含 "api"

# 4. Issue 還在嗎?(有可能被刪 / archive)
curl -fsS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://biglab.buygta.today/api/v4/projects/<id>/issues/<iid>"
```

**修復:**

- DB locked → 通常是 concurrent cron 沒釋放 lock;`rm db/issue-routing.sqlite.cron-lock` 後重跑
- PAT scope 掉到 `read_api` → 重新申請 `api` scope 的 PAT
- Issue 不存在 → state 寫 `status='deleted'`,手動清理:
  ```
  UPDATE issue_state SET status='deleted' WHERE issue_uid='<uid>';
  ```

---

### 6. Daily update dashboard broke after deploy

**症狀:** 部署 issue routing 後,原本的 `/sync` dashboard 出錯(因為同一個 repo、共用 scripts)。

**診斷:**

```bash
git log --oneline -n 20
bun run test:unit
bun run test:integration
```

**修復:**

```bash
# 找出要 revert 的 commit range
git log --oneline feat/issue-routing

# Revert(不要直接 reset,保留 audit trail)
git revert <sha1>..<shaN>
git push origin main

# 然後 re-deploy dashboard
bun run deploy:appscript
```

同時在 issue routing project 開一個 bug ticket 記錄原因,避免下次再踩。

---

## On-call contacts

> **TODO(setup):** 以下空格由工程主管填入後 merge。

| 角色 | 聯絡人 | 聯絡方式 |
|------|--------|----------|
| Primary on-call / 工程主管 | `<FILL-IN>` | `<FILL-IN>` |
| InfoSec / DPO | `<FILL-IN>` | `<FILL-IN>` |
| GitLab / DevOps admin | `<FILL-IN>` | `<FILL-IN>` |
| CSM 窗口(Ivy) | `<FILL-IN>` | `<FILL-IN>` |

---

## Rotation policy

| Secret | Rotation cadence | Notes |
|--------|------------------|-------|
| GitLab PAT(`api` scope) | 每 **90 天** rotate(即使 PAT 本身設 1 年 TTL) | 降低外洩風險;rotate 後記得同步更新 `gitlab-config.json` 並重啟 webhook server |
| `INTERNAL_TOKEN`(webhook 雙向握手) | 每 **6 個月** | 需同步更新 host env + Apps Script Script Properties |
| `ANTHROPIC_API_KEY` | 團隊成員異動時 rotate;否則每年一次 | 從 Anthropic console |
| `webhookSecret`(Chat HMAC) | 每年 | 更新 `chat-config.json` 後重啟 webhook server |

---

## Cost alerts

- Anthropic console 設 budget alert:**weekly > $5 要看原因**
- 常見原因:
  1. eval suite 被反覆跑(每次 $0.50)
  2. 某個 issue 被標籤狂改,觸發多次 re-analyze
  3. 誤設 `ANTHROPIC_API_KEY` 指到 production key 被其他 project 共用
- 驗證:`sqlite3 db/issue-routing.sqlite "SELECT COUNT(*) FROM issue_state WHERE last_posted_at > strftime('%s','now','-7 days');"`,對比預期每週 ~8 issue

---

## TDD / verification before merging doc changes

純文件改動不會 regress 任何功能,但仍建議在 merge 前跑一次:

```bash
bun run test:unit
bun run test:integration
```

確認 issue-routing 程式碼沒被連帶誤動。
