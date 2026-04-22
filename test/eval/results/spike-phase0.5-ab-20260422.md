# Phase 0.5 Spike — Repo Activity Enrichment A/B

Run date: 2026-04-22T13:07:51.898Z

## Setup

- Fixtures: 3 K5 GOLD (300, 302, 304)
- Baseline source: identical to production `phase1-routing.mjs` prompt (CLI mode, model=sonnet)
- Enrichment recipe: baseline prompt + `RECENT REPO ACTIVITY` block appended before the invoke line
- Activity window: since 2026-04-15T13:03:45.068Z (7 days)
- Candidate repos fetched: 20
- Activity block size: ~2442 tokens (9768 chars)

## Per-fixture diff

| iid | ground_truth | baseline_top3 | enriched_top3 | P@1 b/e | R@3 b/e | conf b/e | reasoning (enriched) |
|-----|--------------|---------------|---------------|---------|---------|----------|----------------------|
| 300 | KEYPO/keypo-backend | KEYPO/keypo-newsletter, KEYPO/keypo-backend, KEYPO/keypo-engine-api | KEYPO/keypo-backend, KEYPO/keypo-engine-api | ✗/✓ | ✓/✓ | 0.32/0.35 | 此 issue 屬 K5 產品，核心症狀為試用帳號到期後速報仍持續發送（11/28 到期但送到 12/5），以及帳號延長後尚未生效前即觸發推播，屬帳號有效期邊界驗證與排程任務的 bug。keypo-backend 近期有 MR !385 專門修復速報 cronjob 邏輯（fix(cronjob): prevent xlsx /tmp collision in concurrent alert jobs），是最直接候選；keypo-en |
| 302 | KEYPO/keypo-backend | KEYPO/keypo-frontend-2023, KEYPO/keypo-backend, KEYPO/keypo-engine-api | KEYPO/keypo-frontend-2023, KEYPO/keypo-backend, KEYPO/keypo-engine-api | ✗/✗ | ✓/✓ | 0.28/0.28 | Issue 標示 K5 label，「Unknown error」伴隨左括號與字詞間缺少連接符號的描述，推測為前端 error message 渲染邏輯缺陷或後端回傳錯誤訊息格式化問題；keypo-frontend-2023 近期有 display/overflow 相關修正，keypo-backend 有進行中的 i18n 錯誤訊息重構，皆為合理候選。 |
| 304 | KEYPO/keypo-engine-api | KEYPO/keypo-backend, llmprojects/keypo-agent, KEYPO/keypo-engine-api | KEYPO/keypo-engine-api, KEYPO/keypo-backend | ✗/✓ | ✓/✓ | 0.32/0.38 | 此 issue 描述聲量超過 36,000 筆但 GPT 報告仍顯示「聲量不足」的間歇性錯誤，與 keypo-engine-api !563（'fix(gpt-report): guard against empty posts to prevent GPT hallucination'）所描述的 race condition / ES 暫時空回導致 GPT 誤判場景高度吻合；keypo-backend !360 亦涉及 INSUFFI |

## Aggregate comparison

| Metric | Baseline | Enriched | Δ |
|--------|----------|----------|---|
| P@1 | 0% (0/3) | 67% (2/3) | +0.67 |
| R@3 | 100% (3/3) | 100% (3/3) | +0.00 |
| Conf avg | 0.31 | 0.34 | +0.03 |
| Prompt chars (avg) | 3881 | 13968 | +10087.00 |
| Latency ms (avg) | 33736 | 47609 | +13872.67 |
| Tokens (est, input) | ~971 | ~3492 | +2521 |
| Input cost (est, $ per issue) | $0.0029 | $0.0105 | +$0.0076 |

## Verdict

**PROCEED-TO-PROD** — Enriched prompt hits P@1 ≥ 1/3 on GOLD fixtures — worth wiring into production phase1 behind a feature flag and re-running full eval.

> n=3 is direction only, not statistical proof. Recommend re-running on ≥10 GOLD fixtures before committing to a prod change.

## Activity block (as injected)

```
=== RECENT REPO ACTIVITY (for routing context) ===

[KEYPO/keypo-frontend-2023]
  Open MRs:
    !145 "Draft: test(e2e): add HotChnl page E2E tests and extend bar chart support in shared helpers"
        ## Related Issue(s)

> Base on !144

## What does this MR do?

Adds a comprehensive E2E test suite for the HotChnl (`/hotchnl`) page covering bar chart interactions, tab switching, analysis type switc…
  Recent commits:
    040fb53c docs: add release notes for v1.8.0
    556b27f5 Merge branch 'develop'
    ee090d15 v1.8.0
    230acd87 Merge branch 'feat-international-version' into develop
    647adc39 Merge branch 'fix-issue' into develop
    3557ac8d feat: show No Data gate on topic-required pages when no topic enabled
    d4c09763 fix(social-channel): contain page overflow inside its own scroll area
    2ceadc0a refactor: update hand shaken drinks industry keyword
    8db59765 feat(ai-summary): render citations as inline hyperlinks
    d7db81a6 fix: remove unnecessary scrollbar from mainText

[llmprojects/keypo-agent]
  Open MRs:
    !66 "Draft: feat(evals): add golden evaluation set v1"
        Introduces a first golden Q&A set for evaluating the KEYPO Agent's ability
to answer realistic Taiwan-enterprise-client questions with analyst-grade,
data-grounded responses.

Methodology
-----------…
    !69 "Draft: Integration/bde"
    !47 "Draft: feat: HITL, framework-driven analysis, and API v1 namespace"
        ## Summary

- **HITL (Human-in-the-Loop)**: Add `/continue` endpoint for resuming paused agent runs after tool confirmation, with RunPaused event and session restoration
- **Framework-Driven Analysis*…
  Recent commits: (none)

[KEYPO/keypo-backend]
  Open MRs:
    !385 "fix(cronjob): prevent xlsx /tmp collision in concurrent alert jobs (#360)"
        ## Summary

Fixes #360 — customer `moimoi001` (內政部) intermittently received speed-report emails with a corrupt xlsx attachment showing "部分內容有問題" in Excel. The corruption pattern (`其他` and `各級單位` files…
    !375 "feat(copilot): add user permissions for KEYPO Agent"
        ## Summary

- 新增 `copilot/permissions.py`，提取使用者權限資料並驗證查詢參數
- 每次對話 `send_message` 時將使用者權限 payload 送給 KEYPO Agent
- 查詢前驗證 `allow_sources` 和 `region_permissions`，超出權限回傳 400 + i18n 錯誤訊息

### 權限 Payload 格式…
    !359 "feat(ai-summary): upgrade to Gemini 3.0 Flash Preview"
        ## Summary
- Update model from gemini-2.5-flash to gemini-3-flash-preview
- Update pricing: input $0.50/1M, output $3.00/1M tokens

## Pricing Reference
- [Google AI Gemini API Pricing](https://ai.goo…
    !360 "feat(ai-summary): add i18n support for AI summary"
        ## Summary
- Add `allow_line_break` config to LANGUAGE_CONFIG for explicit line break control
- Refactor `_enforce_paragraph_format` to use config instead of string matching
- Add `INSUFFICIENT_DATA_M…
    !306 "ci: Add GitLab CI/CD pipeline for automated testing"
        ## Summary

* Add comprehensive GitLab CI/CD pipeline with pytest test runner and coverage reporting
* Configure MySQL 8.0 service for database testing
* Set up Python 3.12 environment matching projec…
  Recent commits:
    6aa598c5 Merge branch 'master' into develop
    2dead3eb Merge branch 'fix/ai-summary-logic' into 'develop'
    ee0f8f47 feat(ai-summary): decouple daily stats from article fetch
    4b32002a Merge branch 'develop' into 'master'
    517162c8 perf(gpt-report): avoid sort buffer exhaustion on list endpoints
    4d52b2fd Merge branch 'fix/gpt-report-list-sort-memory' into 'develop'
    ad749e0b perf(gpt-report): avoid sort buffer exhaustion on list endpoints
    1c0b9805 Merge branch 'develop' into 'master'
    f356b6e6 feat: release ai-summary, company channel filter, channel analytics
    a7eaf331 Merge branch 'feature/ai-summary' into 'develop'

[KEYPO/keypo-engine/keypo-engine-api-v3]
  Open MRs: (none)
  Recent commits:
    b4e18a66 Merge branch 'master' into develop
    2f29646c Merge branch 'fix/daily-trend-universe' into 'develop'
    e0dd4f4a docs(spec): v1.8 T12 daily_trend universe alignment
    050e0151 fix(daily_trend): filter universe by post_time_utc to match daily_summary
    61355476 Merge branch 'fix/sub_kw_special_terms' into 'develop'
    36ce3fe2 fix: fix special terms does not use upper case
    555e1a90 Merge branch 'develop' into 'master'
    e21a57fe Release 3.1.1: sub_kw highlight (textlist + getcontentbyref)
    22038eaf Merge branch 'fix/sub_kw' into 'develop'
    4cd9b6ee feat(getcontentbyref): wrap sub_kw in highlight spans via post-process

[KEYPO/keypo-engine/on-premises-api-gateway]
  Open MRs: (none)
  Recent commits:
    b260a5fd feat(consumers): add engineer-yuriy, keypo-engine-api-international and production consumers
    a19e4bca feat: double rate limits for keypo cluster and keypo-engine-api-production
    8bd92a72 feat: add international tsdb upstream, route and consumers
    2f408030 feat(consumers): add promo-post-detection consumer

[KEYPO/keypo-engine/data-collector]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/keypo-engine-gateway]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine-api]
  Open MRs:
    !572 "docs: add keypo-alert-triage skill for 速報 missing article investigation"
        ## Summary

新增速報文章遺漏排查 skill，標準化「為什麼文章沒出現在速報裡」的排查流程。

### 三步排查流程
1. **文章列表驗證**（1 分鐘）— 用相同關鍵字查 KEYPO 確認文章是否在搜尋範圍內
2. **查 ES init_fetchedtime**（5 分鐘）— 確認爬蟲抓取時間是否晚於速報搜尋範圍
3. **查 GCP Log 原始查詢**（15-30 分鐘）—…
    !571 "feat(gpt): upgrade model to gpt-4.1-mini + tighten conclusion word limit"
        ## Summary
- Upgrade GPT model from `gpt-4o-mini` to `gpt-4.1-mini` (available on both OpenAI and Azure Classic)
- Tighten conclusion per-point word limit from 40-60 to 30-50 Traditional Chinese words…
    !563 "fix(gpt-report): guard against empty posts to prevent GPT hallucination"
        ## Summary

- When ES returns no posts (due to race condition, cold queries, or timeouts), GPT receives an empty prompt and fabricates irrelevant content (e.g. "環保意識的提升" for a 星城Online report)
- Add e…
    !543 "fix: dedupe FilterSearch results with composite key"
        ### Related Issue(s):

Closes #101

### What does this MR do?

Enhances the FilterSearch class to eliminate duplicate results by implementing comprehensive deduplication using a composite key approach…
    !525 "[feat] Add Channel Influence API"
        ## Summary

Implement Channel Influence API to analyze and rank top 40 channels based on engagement metrics (likes, comments, shares, views) for articles matching query keywords.

## Feature Requireme…
  Recent commits: (none)

[KEYPO/keypo-engine/keypo-engine-api-gateway]
  Open MRs:
    !58 "release: priority-queue v2 (0.0.9)"
        ## Summary

Merge develop → main for production release 0.0.9.

### What's included
- **Priority Queue v2**: Two-layer SWRR plugin with Redis leaky bucket (rate=60, burst=1)
- **Atomic Redis EVAL**: F…
    !59 "refactor(monitoring): migrate to GMP PodMonitoring"
        ## Summary
- Replace external Prometheus VM + Nginx metrics-proxy + Internal LB with Google Cloud Managed Prometheus (GMP) `PodMonitoring` CRDs
- Add `PodMonitoring` for APISIX and Redis metrics scrap…
    !48 "feat(load-test): per-API ramping load test plan and log parser"
        Description:

## Summary

- Per-API ramping load test 實作計劃（17 支 API，RPS 5→120 階梯）
- 補測混合流量場景（08-09 尖峰 + business 時段）
- 根據退化拐點數據設定 rate limit 閾值
- Log parser 支援 GCP Cloud Logging legacy/JSON 格式

## Fil…
    !46 "feat: config refactor, local-limit-req, request-id, and per-group API ACL"
        ## Summary

### Config 管理重構
- Rate limit / Redis / timeout 值寫死在 `routes.yaml.tpl`，移除環境變數間接層
- `envsubst` 只需 `ENGINE_API_HOST` / `ENGINE_API_PORT`
- `.gitlab-ci.yml` 和 `.env.*` 清理所有 `RATE_LIMIT_*` 變數…
    !5 "feat(plugins): add username-auth plugin"
        ## Summary
- Add username-auth plugin for header-based consumer identification
- Allows backend services to pass authenticated username via header
- APISIX identifies consumer based on header value

#…
  Recent commits: (none)

[KEYPO/keypo-engine/analyzer-and-qtool-testcase]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-q-huaan-v2]
  Open MRs: (none)
  Recent commits:
    b049e0a8 tweak qmanager-es
    0a2097d0 add es5 jp new data raw

[KEYPO/keypo-engine/qtool]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/line-notify-backend-2023]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-international-website]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-newsletter]
  Open MRs:
    !16 "feat: Complete user authentication system with enhanced password change flow"
        ### Related Issue(s):

Closes #7

### What does this MR do?

Completes the migration from custom API-based authentication to Django's built-in system. This MR adds a comprehensive user settings page a…
    !14 "add cc4cl"
  Recent commits:
    d858b32d Merge branch 'develop' into 'main'
    5891ee8b Merge branch 'fix/gemini-tag-verbatim-leak' into 'develop'
    ba81e58a fix(gemini): sanitize [我方]/[競品] tag verbatim leak in summary output
    2bf3326e Merge branch 'fix/gemini-brand-only-prompt' into 'develop'
    afeeee89 fix(gemini): conditional competitor classification rule (no-competitor settings)
    7197e86b Merge branch 'develop' into 'main'
    2f04bf88 Merge branch 'fix/ai-summary-brand-competitor-tagging-v2' into 'develop'
    add49f62 fix(gemini): prevent competitor brands from appearing in client section (#359)

[KEYPO/keypo-data-api]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine-layer]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-questionnaire]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-micro-portal]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-status-check]
  Open MRs: (none)
  Recent commits: (none)

```

## Raw per-fixture outputs

### Fixture 300 — 20260105 - 試用帳號_帳號到期後更新延長的時間前推播了先前設定的速報

**Ground truth:** primary=`KEYPO/keypo-backend`, all=["KEYPO/keypo-backend"]

**Baseline**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-newsletter",
    "KEYPO/keypo-backend",
    "KEYPO/keypo-engine-api"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 標記 K5，描述試用帳號到期後速報仍持續寄送、以及帳號延長後提前推播的異常行為，核心問題在於速報排程未正確檢查帳號有效期間邊界，最可能涉及 keypo-newsletter（速報寄送邏輯）與 keypo-backend（帳號有效期管控）。",
  "confidence": 0.32,
  "caveats": [
    "無任何相似歷史 issue（cold start），路由純依 issue 描述推斷，建議 triage 人員手動確認。",
    "速報排程觸發點不明，可能在 keypo-newsletter、keypo-backend 或 keypo-engine-api 任一層，需逐一確認 log。",
    "issue 提及帳號到期後仍發送至 12/5（遲滯 7 天），暗示可能有 job queue 或 retry 機制未清除，需確認排程系統架構。",
    "suggested_assignees 無法推薦（無歷史資料），請 triage 人員依 keypo-newsletter 維護負責人指派。"
  ],
  "error": null,
  "latency_ms": 24440,
  "prompt_chars": 3433
}
```

**Enriched**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-backend",
    "KEYPO/keypo-engine-api"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 屬 K5 產品，核心症狀為試用帳號到期後速報仍持續發送（11/28 到期但送到 12/5），以及帳號延長後尚未生效前即觸發推播，屬帳號有效期邊界驗證與排程任務的 bug。keypo-backend 近期有 MR !385 專門修復速報 cronjob 邏輯（fix(cronjob): prevent xlsx /tmp collision in concurrent alert jobs），是最直接候選；keypo-engine-api 近期新增速報排查 skill（MR !572），顯示速報發送流程橫跨兩個 repo。",
  "confidence": 0.35,
  "caveats": [
    "Cold start：無歷史相似 issue，無法從 assignee 頻率推薦負責人，建議 triage 人員自行指派熟悉速報排程與帳號有效期驗證邏輯的工程師",
    "帳號有效期驗證可能在 keypo-backend（cronjob 啟動前檢查訂閱狀態）或 keypo-engine-api（查詢發送前驗證），需確認速報觸發點位於哪一層",
    "此 issue 實際上包含兩個獨立 bug：(1) 帳號到期後速報持續多送 7 天；(2) 延長帳號後提前推播——可能同源但建議分別確認復現條件",
    "KEYPO/keypo-newsletter 有日報相關功能，若速報是透過 newsletter repo 排程，則該 repo 也應列入排查範圍"
  ],
  "error": null,
  "latency_ms": 50488,
  "prompt_chars": 13520
}
```

### Fixture 302 — 20260106 - 錯誤訊息顯示Unknown error

**Ground truth:** primary=`KEYPO/keypo-backend`, all=["KEYPO/keypo-backend"]

**Baseline**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-frontend-2023",
    "KEYPO/keypo-backend",
    "KEYPO/keypo-engine-api"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 帶有 K5 標籤，描述為錯誤訊息顯示格式異常（左括號與字詞間缺少連接符），判斷問題可能出在前端錯誤訊息渲染邏輯或後端回傳的錯誤字串組成，故優先建議 keypo-frontend-2023 與 keypo-backend；若錯誤源自 engine 層的 API 回傳，則 keypo-engine-api 亦為候選。",
  "confidence": 0.28,
  "caveats": [
    "冷啟動：無任何相似歷史 issue，無法依據過去處理頻率推薦 assignee，建議人工指派",
    "錯誤訊息格式問題可能橫跨前端渲染與後端字串組成兩層，需 triage 人員先確認錯誤訊息的產生來源",
    "issue 來源 project 為 techcenter/reportcenter_confidential，與 KEYPO group 不同，可能涉及跨 group 整合點，需確認是否為 report center 自身的顯示問題",
    "截圖無法在此解析（uploads 連結），triage 人員應查看圖片以確認錯誤訊息的完整內容"
  ],
  "error": null,
  "latency_ms": 31099,
  "prompt_chars": 3147
}
```

**Enriched**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-frontend-2023",
    "KEYPO/keypo-backend",
    "KEYPO/keypo-engine-api"
  ],
  "suggested_assignees": [],
  "reasoning": "Issue 標示 K5 label，「Unknown error」伴隨左括號與字詞間缺少連接符號的描述，推測為前端 error message 渲染邏輯缺陷或後端回傳錯誤訊息格式化問題；keypo-frontend-2023 近期有 display/overflow 相關修正，keypo-backend 有進行中的 i18n 錯誤訊息重構，皆為合理候選。",
  "confidence": 0.28,
  "caveats": [
    "冷啟動：無相似歷史 issue，路由純依 label 與描述推斷，信心度偏低",
    "「Unknown error」為泛用錯誤，需先確認觸發的 API endpoint 才能精準定位是前端 catch 未正確解析，或後端回傳 HTTP error body 格式不符",
    "issue 來源專案 techcenter/reportcenter_confidential 不在 K5 known_exceptions 清單中，可能涉及跨 team 確認",
    "無歷史 assignee 資料，建議 triage 人員依熟悉 reportcenter 功能的工程師手動指派",
    "近期 repo 活動內容（E2E tests、AI summary、rate limit）與此 error message 症狀無明顯對應，活動資訊對路由無額外增強"
  ],
  "error": null,
  "latency_ms": 51740,
  "prompt_chars": 13234
}
```

### Fixture 304 — 20260108 - 某客戶_聲量有超出100筆的聲量數值，不過AI報告顯示聲量不足，暫時無法提供精確的GPT分析結果

**Ground truth:** primary=`KEYPO/keypo-engine-api`, all=["KEYPO/keypo-engine-api"]

**Baseline**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-backend",
    "llmprojects/keypo-agent",
    "KEYPO/keypo-engine-api"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 標記 K5 與 Data，核心問題為客戶查詢聲量達 36,720 筆時 AI 報告仍觸發「聲量不足」邏輯，推測為 keypo-backend 的報告產生流程中聲量門檻判斷有競態條件或快取失效，且涉及 GPT 分析觸發，應同步排查 keypo-agent 與 keypo-engine-api 的分析前置條件檢查。",
  "confidence": 0.32,
  "caveats": [
    "冷啟動：無任何相似歷史 issue，路由判斷完全依賴標籤語義與問題描述推測，信心偏低",
    "問題具明顯時間性（09:20 複現、11:02 正常），可能涉及快取、競態條件或分散式資料同步延遲，實際根源 repo 須進一步 debug 才能確認",
    "無歷史 assignee 資料（冷啟動），無法推薦負責人，請 triage 人員依 KEYPO backend 與 LLM 值班人員手動指派",
    "Data label 可能暗示資料管線（CrawlersV2）抵達延遲導致查詢時間點資料量不足，若 KEYPO 應用層排查無果，應擴大至 Crawlers 群組"
  ],
  "error": null,
  "latency_ms": 45670,
  "prompt_chars": 5062
}
```

**Enriched**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-engine-api",
    "KEYPO/keypo-backend"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 描述聲量超過 36,000 筆但 GPT 報告仍顯示「聲量不足」的間歇性錯誤，與 keypo-engine-api !563（'fix(gpt-report): guard against empty posts to prevent GPT hallucination'）所描述的 race condition / ES 暫時空回導致 GPT 誤判場景高度吻合；keypo-backend !360 亦涉及 INSUFFICIENT_DATA 訊息的 i18n 處理，兩者皆為強候選。",
  "confidence": 0.38,
  "caveats": [
    "冷啟動：無相似歷史 issue，無法根據歷史 assignee 頻率推薦人員，suggested_assignees 留空，請 triage 人員手動指派",
    "keypo-engine-api !563 描述的 race condition / ES 空回場景與此 issue 症狀最吻合，但需確認該 MR 是否已 merge 至 master；若已 merge 則問題可能已部分修復或有 regression",
    "問題具時間性：客戶 09:20–09:21 復現，Joanne 11:02 複查正常，暗示 transient 問題，排查時需比對當時 ES query log 與 GPT 呼叫 log",
    "keypo-backend !360 觸及 INSUFFICIENT_DATA 訊息的 i18n 設定，若 threshold 判斷邏輯有誤可能跨 backend 與 engine-api 兩層，需協同排查"
  ],
  "error": null,
  "latency_ms": 40599,
  "prompt_chars": 15149
}
```
