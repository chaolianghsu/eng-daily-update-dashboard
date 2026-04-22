# Issue Routing System

自動分析 GitLab 新 issue、建議 routing + plan draft、由 IC 在 Google Chat 審核後回貼到 GitLab 的內部工程效率工具。

> Audience: IC 工程師、工程主管、on-call、CSM 合作窗口(如 Ivy)
> 相關 plan: `docs/superpowers/plans/2026-04-22-issue-routing.md`

---

## 1. What it does

系統每 15 分鐘自動掃描 `techcenter/reportcenter` 與 `techcenter/reportcenter_confidential` 兩個 GitLab 專案的新 issue,透過 Sonnet 4.6 兩階段 LLM 分析,產出 routing suggestion(建議 repos + assignees)與 plan draft(3-5 步實作步驟),接著在 Google Chat daily-update space 貼出帶有 ✅ Approve / ✏️ Edit / ❌ Dismiss 按鈕的 card。IC 按下 Approve 後,plan 會以 GitLab comment 的形式回貼到原 issue。目的是**降低 triage latency + status drift**:不再讓 issue 在 label 對不上 repo 的狀態下堆積,也不再讓 CSM 看不到 engineering 對 issue 的 first response。

---

## 2. Who uses it

| 角色 | 如何互動 |
|------|----------|
| **IC 工程師** | 看 Google Chat 的 card,按 Approve / Edit / Dismiss。Edit 會開 dialog 讓你改 plan 再送出。 |
| **CSM(Ivy 等)** | 在 GitLab issue comment 看到 approved plan,知道 engineering 已接收且初步有計畫。 |
| **工程主管** | 透過 `/sync` dashboard 看 issue 與 daily update 的對應情況;每月看 `audit-routing-config.mjs` 產出的 drift report。 |
| **On-call** | 遇到 incident 時看 `OPERATIONS.md` 跑 runbook。 |

---

## 3. How it flows

```
New GitLab issue  ┐
                  ├──▶ [Cron 15min] collect-new-issues.mjs
                  │        ↓ diff vs state
                  │    [SQLite state]
                  │        ↓
                  └──▶ [Cron 15min] analyze-and-post.mjs
                          ↓ Phase 1: Sonnet 4.6 tool_use → routing + confidence
                          ↓ Phase 2: plan draft (only if confidence >= 0.5)
                          ↓
                      [Google Chat card post]
                          ↓ IC clicks Approve/Edit/Dismiss
                      [Apps Script doPost]
                          ↓ HTTPS + X-Internal-Auth
                      [handle-approval-webhook.mjs]
                          ↓ postIssueComment (api scope)
                      [GitLab issue comment]
```

- **Stage 1 (collect)** 只做 fetch + hash diff,不花 LLM 費用。
- **Stage 2 (analyze+post)** 才呼叫 LLM。Phase 2 (plan draft) 只在 Phase 1 confidence ≥ 0.5 時才執行,省錢也避免給 IC 亂猜的內容。
- Apps Script 作為 Chat button 的 webhook 接收端,透過 HTTPS + `X-Internal-Auth` header 轉發到本機 `handle-approval-webhook.mjs`。這讓實際寫入 GitLab 的邏輯留在 node 環境、方便測試與除錯。

---

## 4. Setup / install (for a new host)

從零架設一台新 host 請依序執行:

### 4.1 Clone + install deps

```bash
git clone git@github.com:<org>/eng-daily-update-dashboard.git
cd eng-daily-update-dashboard
bun install
```

### 4.2 Config files

這三個檔案都 **gitignored**,需要在每台 host 各自放置:

| File | 內容 | 來源 |
|------|------|------|
| `gitlab-config.json` | `baseUrl`、`token` (GitLab PAT, scope: `api`)、`memberMap`、`excludeAuthors` | 向 GitLab admin 申請 PAT,參考 `docs/superpowers/designs/2026-04-22-issue-routing-blockers-drafts.md` 的 T3 draft |
| `chat-config.json` | `spaceId`(daily-update space)、`memberMap`、`webhookSecret`(256-bit random,用於 Chat card button 驗簽) | 從既有 dashboard host copy;`webhookSecret` 初次建立時以 `openssl rand -hex 32` 產生 |
| `config/label-routing.yaml` | label → repo / layer / exception 的 routing 表 | 檢 in repo,直接 `git pull` 即可 |

### 4.3 Env vars

在啟動 cron 與 webhook server 的 shell(`.env` / systemd `Environment=` / launchd plist)設定:

```bash
ANTHROPIC_API_KEY=sk-ant-<token>        # Anthropic console
INTERNAL_TOKEN=<random-256-bit-hex>      # 共享給 Apps Script,openssl rand -hex 32
PORT=3099                                # webhook server listen port
ALLOW_CONFIDENTIAL_LLM=true              # 依 DPA 結果決定,目前已確認為 true
```

> **Note:** 先前 T1 (Legal/InfoSec DPA) 已確認 Anthropic 的 commercial terms 涵蓋內部 issue 內容(input 不進訓練資料集),所以 `ALLOW_CONFIDENTIAL_LLM=true`。若之後條款變更,改成 `false` 即可讓 confidential 專案退回 labels-only 路由,**不需改 code**。

### 4.4 GitLab PAT

必須是 **`api` scope**(不是 `read_api`)。原因:`api` 才能寫 issue comment。申請流程見 T3 draft。PAT 有效期建議 1 年,**仍請每 90 天 rotate 一次**(見 `OPERATIONS.md`)。

### 4.5 Apps Script properties

在 Apps Script editor → Project Settings → Script Properties 設定:

| Key | Value |
|-----|-------|
| `ISSUE_ROUTING_BACKEND_URL` | `https://<your-host>:3099/approve`(本機 webhook server 對外 URL,建議走反向代理 + TLS) |
| `ISSUE_ROUTING_INTERNAL_TOKEN` | 必須與 env `INTERNAL_TOKEN` 完全一致 |

### 4.6 SQLite migration

```bash
bun run issue-routing:migrate
# 確認 schema 存在
sqlite3 db/issue-routing.sqlite ".schema issue_state"
```

### 4.7 Cron

`/etc/crontab` 或 `crontab -e`:

```
*/15 * * * * cd /path/to/eng-daily-update-dashboard && ./scripts/run-issue-routing.sh >> /var/log/issue-routing.log 2>&1
```

### 4.8 Webhook server

單純跑法:

```bash
node scripts/handle-approval-webhook.mjs
```

生產環境建議用 systemd(`/etc/systemd/system/issue-routing-webhook.service`):

```ini
[Unit]
Description=Issue routing approval webhook
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/eng-daily-update-dashboard
EnvironmentFile=/etc/issue-routing.env
ExecStart=/usr/bin/node scripts/handle-approval-webhook.mjs
Restart=on-failure
RestartSec=5
User=dashboard

[Install]
WantedBy=multi-user.target
```

啟用:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now issue-routing-webhook
sudo systemctl status issue-routing-webhook
```

---

## 5. Operator actions — Chat card UX

每張 Chat card 底部有三顆按鈕:

| Button | 行為 |
|--------|------|
| ✅ **Approve** | 把目前 card 上的 plan draft 以 markdown comment 回貼到 GitLab issue。State 記為 `approved`、`approved_by=<你的 Chat user>`、`gitlab_comment_id=<note id>`。Card 更新成「Approved by X at HH:MM, comment: <link>」。 |
| ✏️ **Edit** | 開一個 dialog,內含目前的 plan draft(可編輯)。送出後,**以你的編輯版本**為準回貼 GitLab。state 記為 `edited`。 |
| ❌ **Dismiss** | 不動 GitLab。Card 標記為 dismissed。若之後 issue labels 變動 / description 改到讓 hash 改變,cron 會 re-analyze 並再貼一次(此時 `approval_status` 會被 reset 成 `pending`)。 |

> **Re-entry:** 任何 button 按下後,state 都是原子更新(SQLite transaction),同一張 card 不會被 double-approve。若 Phase 1 confidence < 0.5,Approve 按鈕雖然可按,但 plan 欄位會是 null,這時 Approve 只會回貼 summary(而非 plan steps)。

---

## 6. Label routing — how to edit

Routing 表維護在 `config/label-routing.yaml`。**這個檔案是 single source of truth**,不要在 code 裡硬寫 label → repo 對應。

### 6.1 Format walkthrough

```yaml
labels:
  # 一般 label: 有一個 primary_group,少量 known_exception 走別的 group
  K5:
    product: KEYPO
    primary_group: KEYPO
    known_exceptions:
      - llmprojects/keypo-agent   # K5 agent 相關 issue 走這裡,不是 KEYPO group

  # Fanti: 跨 group,必須用 layers 切
  Fanti:
    product: Fanti
    primary_group: null
    layers:
      crawler:   [CrawlersV2/fanti-insights-api]
      backend:   [cdp/fanti-insights-backend, cdp/fanti-review-backend]
      ui:        [cdp/fanti-insights-dashboard, cdp/fanti-review-dashboard]
      nginx:     [cdp/fanti-review-nginx, cdp/fanti-insights-nginx]
      keypo_integration: [KEYPO/fanti_info_web, KEYPO/fanti_manager]

  # Data: 只有 primary_group,沒有 exception,最單純
  Data:
    product: Data ops
    primary_group: Crawlers
    known_exceptions:
      - CrawlersV2
      - bigdata1

ignore_for_routing:
  - P1_高
  - P2_中
  - Bug
  - Feature
```

### 6.2 When to add a `known_exception`

- 月底 `scripts/audit-routing-config.mjs` 跑出的 drift report 標出某 label 有 ≥ 3 次實際 routing 去了另一個 repo
- IC 反覆在 Edit dialog 手動改成某個 repo(系統沒學到)

### 6.3 PR flow

1. `git checkout -b routing/<label>-<reason>`
2. 改 `config/label-routing.yaml`
3. 跑 `bun run test:unit -- config` 驗 YAML 合法
4. Open PR,**找另一位 IC review**(避免單人偏見固化到系統)
5. Merge 後,host 上 `git pull`;**不用重啟任何 service**,下一次 cron(最多 15 分鐘內)會讀到新 config

---

## 7. What to do when system says "low confidence"

Card header 會顯示 `信心 <50%`,`plan_draft` 欄位為 null,只有 summary。意思是:

- 系統在過去 closed issue 裡找不到夠像的樣本(cold start)
- 或 issue 描述太短 / 太模糊,LLM 不敢給建議

**IC 應該做的:**

1. 照舊手動 triage(當系統不存在)
2. 若你發現這個 issue 其實屬於某個已知 label 但 system 沒抓到,**加一個該 label 上去**;下次 cron 會 re-analyze
3. 若這類 issue 反覆 low-confidence,考慮開 PR 加 `known_exception`,或把這類 issue 的一份 anonymized snapshot 丟進 `test/eval/fixtures/` 當作未來 prompt tuning 的材料

---

## 8. Cost

| Item | Approx |
|------|--------|
| 每週新 issue 量 | ~8 issues/week(歷史均值) |
| 每 issue LLM calls | 2(Phase 1 routing + Phase 2 plan) |
| Weekly calls | ~16 Sonnet 4.6 calls |
| 每次分析成本 | $0.05 - $0.10(視 similar-issue context size) |
| **Weekly LLM cost** | **$1 - $2** |
| Eval suite(手動在 prompt change 時跑一次) | $0.50 / run |
| **Monthly total** | **~$5 - $10** |

> 若週成本突破 **$5**,先檢查是否 eval suite 被反覆跑、或某 issue 因 label 反覆變動被 re-analyze 過多次。Budget alert 設在 Anthropic console。

---

## 9. Monitoring

### 9.1 Eval suite

```bash
# Offline lint(不花 LLM 費用,只驗 fixture schema + config coverage)
bun run issue-routing:eval -- --offline

# Full run(with API key,跑 20 golden fixtures)
ANTHROPIC_API_KEY=sk-ant-<token> bun run issue-routing:eval
# gate: ≥18/20 pass
```

### 9.2 Monthly drift audit

```bash
node scripts/audit-routing-config.mjs
# 產出檔案: ~/.gstack/projects/issue-routing-audit-YYYY-MM-DD.md
```

Audit 報告列出過去 100 個 closed issue 的 actual repo vs config-suggested repo,用來判斷是否該加 `known_exception`。

### 9.3 State DB 快查

現況分布:

```bash
sqlite3 db/issue-routing.sqlite \
  'SELECT status, approval_status, COUNT(*) FROM issue_state GROUP BY 1, 2;'
```

Expected(穩態):

```
open      | pending    | <低個位數,還在等 IC action>
open      | approved   | <主要佔比>
open      | dismissed  | <少量>
closed    | approved   | <主要佔比,歷史累積>
failed    | pending    | 0   ← 若 >0 是警訊,看 post_failures
```

### 9.4 Chat test space

**TODO(setup):** 把下面這一行換成你家的實際 test spaceId:

```
staging Chat space: spaces/<FILL-IN>
```

測試 card 先丟這裡、確認 render 正確再丟 prod daily-update space。

---

## 10. Disabling / kill switch

從粗到細:

| Scenario | Action |
|----------|--------|
| 全停 | Comment out cron line(`crontab -e`),pipeline 立即停止分析與貼文 |
| 只停 confidential | Set env `ALLOW_CONFIDENTIAL_LLM=false` + restart webhook server。`reportcenter_confidential` 的 issue 改走 labels-only 路由(不送 LLM),`reportcenter` 繼續 LLM 分析 |
| 只停 approval(保留分析) | `systemctl stop issue-routing-webhook`。Card 還是會貼,但按 Approve 會失敗 → state 留 `pending`,之後 webhook 回來再按就行 |
| 全部清空重跑 | **危險操作**,先備份 `db/issue-routing.sqlite`,然後 `rm db/issue-routing.sqlite && bun run issue-routing:migrate`。所有 issue 會被重新當成新的分析 |

---

## 11. Links

- Design doc: [`docs/superpowers/designs/2026-04-21-issue-routing-design.md`](../superpowers/designs/2026-04-21-issue-routing-design.md)
- Test plan: [`docs/superpowers/designs/2026-04-21-issue-routing-test-plan.md`](../superpowers/designs/2026-04-21-issue-routing-test-plan.md)
- Implementation plan: [`docs/superpowers/plans/2026-04-22-issue-routing.md`](../superpowers/plans/2026-04-22-issue-routing.md)
- Blocker drafts (T1 / T3): [`docs/superpowers/designs/2026-04-22-issue-routing-blockers-drafts.md`](../superpowers/designs/2026-04-22-issue-routing-blockers-drafts.md)
- Operations runbook: [`OPERATIONS.md`](./OPERATIONS.md)
