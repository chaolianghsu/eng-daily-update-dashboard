# Phase 0.5 Spike v2 — Repo Activity Enrichment A/B (historical window)

Run date: 2026-04-22T13:26:40.979Z

## Setup

- Fixtures: 3 K5 GOLD (300, 302, 304)
- Baseline source: identical to production `phase1-routing.mjs` prompt (CLI mode, model=sonnet)
- Enrichment recipe: baseline prompt + `RECENT REPO ACTIVITY` block appended before the invoke line
- Activity window: **per-fixture historical** — anchored to each fixture's `issue.closed_at` (−7d to +1d)
- MR query: `state=all` with `updated_after/updated_before` (v2; v1 used `state=opened` which misses already-merged fix MRs)
- Candidate repos fetched: 20

### Per-fixture activity windows

| iid | closed_at | since | until | activity tokens | fetch ms |
|-----|-----------|-------|-------|-----------------|----------|
| 300 | 2026-01-28T03:33:20.532Z | 2026-01-21T03:33:20.532Z | 2026-01-29T03:33:20.532Z | ~2597 | 3502 |
| 302 | 2026-01-28T03:33:02.438Z | 2026-01-21T03:33:02.438Z | 2026-01-29T03:33:02.438Z | ~2597 | 2923 |
| 304 | 2026-02-11T03:21:43.736Z | 2026-02-04T03:21:43.736Z | 2026-02-12T03:21:43.736Z | ~2842 | 2743 |

## Per-fixture diff

| iid | ground_truth | baseline_top3 | enriched_top3 | P@1 b/e | R@3 b/e | conf b/e | reasoning (enriched) |
|-----|--------------|---------------|---------------|---------|---------|----------|----------------------|
| 300 | KEYPO/keypo-backend | KEYPO/keypo-newsletter, KEYPO/keypo-backend | KEYPO/keypo-backend, KEYPO/keypo-newsletter | ✗/✓ | ✓/✓ | 0.32/0.42 | 此 issue 核心症狀為試用帳號到期後仍持續發送速報、以及帳號尚未生效前即觸發排程發送，屬於 SendingJob 排程與帳號有效日期驗證的邏輯缺陷；keypo-backend 近期 MR !364（fix(cronjob): add active_date check in generate_sending_jobs，描述為「Prevent SendingJob creation for accounts whose active_ |
| 302 | KEYPO/keypo-backend | KEYPO/keypo-frontend-2023, KEYPO/keypo-backend, KEYPO/keypo-engine-api | KEYPO/keypo-frontend-2023, KEYPO/keypo-backend | ✗/✗ | ✓/✓ | 0.28/0.30 | Issue 標籤為 K5，屬 KEYPO 產品範疇；錯誤訊息格式錯誤（左括號與字詞間缺少連接符號）多為前端渲染或後端錯誤訊息組裝問題，keypo-frontend-2023 負責 UI 呈現，keypo-backend 近期 MR !366 也明確修正 reportcenter_confidential 的 issue，兩者皆為強候選。 |
| 304 | KEYPO/keypo-engine-api | llmprojects/keypo-agent, KEYPO/keypo-backend, KEYPO/keypo-engine-api | llmprojects/keypo-agent, KEYPO/keypo-backend, KEYPO/keypo-engine-api-v3 | ✗/✗ | ✓/✗ | 0.32/0.32 | 此 issue 核心症狀為 AI 報告誤判聲量不足（實際 36k+ 筆），且同一時段不同帳號結果不同，高度指向 AI 分析層的帳號設定或閾值邏輯問題；`llmprojects/keypo-agent` 近期有 `feat(agents): inject user settings into prompt` 與 PDF 報告生成 MR，與帳號差異造成 GPT 分析結果不同的症狀吻合，為首選；`KEYPO/keypo-backend` 為次 |

## Aggregate comparison

| Metric | Baseline | Enriched | Δ |
|--------|----------|----------|---|
| P@1 | 0% (0/3) | 33% (1/3) | +0.33 |
| R@3 | 100% (3/3) | 67% (2/3) | -0.33 |
| Conf avg | 0.31 | 0.35 | +0.04 |
| Prompt chars (avg) | 3881 | 14912 | +11031.33 |
| Latency ms (avg) | 28036 | 34777 | +6740.33 |
| Tokens (est, input) | ~971 | ~3728 | +2757 |
| Input cost (est, $ per issue) | $0.0029 | $0.0112 | +$0.0083 |

## Verdict

**PROCEED-TO-PROD** — Enriched prompt hits P@1 ≥ 1/3 on GOLD fixtures — worth wiring into production phase1 behind a feature flag and re-running full eval.

> n=3 is direction only, not statistical proof. Recommend re-running on ≥10 GOLD fixtures before committing to a prod change.

## Raw per-fixture outputs

### Fixture 300 — 20260105 - 試用帳號_帳號到期後更新延長的時間前推播了先前設定的速報

**Ground truth:** primary=`KEYPO/keypo-backend`, all=["KEYPO/keypo-backend"]
**Window:** since=`2026-01-21T03:33:20.532Z`, until=`2026-01-29T03:33:20.532Z` (anchored to closed_at=`2026-01-28T03:33:20.532Z`)

**Activity block (as injected):**
```
=== RECENT REPO ACTIVITY (for routing context) ===

[llmprojects/keypo-agent]
  Open MRs:
    !33 "Release v2.0.0: Gemini Migration, Observability, and Architecture Improvements"
        ## Release Summary

Major release bringing LLM provider migration, comprehensive observability, and significant architecture improvements. This release includes 25 commits across 131 files with 3,201…
    !34 "refactor(workflow): restructure keyword workflow with dedicated repair step"
        ## Summary
- Extract keyword repair logic from build_step into dedicated repair_step for better separation of concerns
- Convert construct_query_string_tool from WorkflowTools wrapper to direct @tool…
    !29 "fix(integrations/keypo): respect user-provided settings without forced defaults"
        ## Summary
- Remove hardcoded default parameters that were overriding user-specified settings
- Fix agent behavior to respect user-provided `type`, `pt`, and `q_fields` values
- Ensure immutable/mutab…
    !31 "refactor: restructure agents to app/ai/keypo and migrate to Skills"
        ## Summary
- Restructured the entire agent architecture from `app/agents` to `app/ai/keypo` to better organize AI components by product
- Replaced VectorDB/preset questions system with 28 Agno Skills…
    !30 "fix(agents): pass API key explicitly to OpenAIModerationGuardrail"
        ## Summary

Fixes OpenAIModerationGuardrail initialization error where the API key was not being passed explicitly, causing it to fail when reading from environment variables.

## Changes

- Pass `api…
  Recent commits:
    00276533 Merge branch 'dev' into 'master'
    fc0b408c refactor(agents): migrate from OpenAI to Gemini 2.5 Flash
    27090794 refactor(agents): move all agent modules to keypo namespace
    b783e23a Merge branch 'refactor/keyword-workflow-with-repair' into 'dev'
    ba6b16a4 refactor(workflow): restructure keyword workflow with dedicated repair step
    c4d7c71c fix(agents/knowledge): replace hardcoded company name with dynamic topic_name in market trend template
    879521d5 refactor(conversation): update session state before team execution
    401cee44 Merge branch 'fix/agent-follow-user-setting' into 'dev'
    4b6c5c82 fix(integrations/keypo): respect user-provided settings without forced defaults
    56e529b2 fix(agents): correct template parameter name in analysis_agent

[KEYPO/keypo-engine/keypo-engine-api-v3]
  Open MRs:
    !65 "fix: resolve commentdist feature issues and sync with legacy API"
        ## Summary

修復「相關聲量」(commentdist) 功能的 Server 500 錯誤，並與 Legacy API 行為同步。

### Commits

1. **fix: resolve params.method AttributeError in commentdist**
   - 將 `params.method not in ["v2/rapidkw"]` 改為 `"…
    !64 "fix: resolve commentdist feature issues and sync with legacy API"
        ## Summary

修復「相關聲量」(commentdist) 功能的 Server 500 錯誤，並與 Legacy API 行為同步。

### 修改內容

1. **Fix params.method AttributeError**
   - 將 `params.method not in ["v2/rapidkw"]` 改為 `"rapidkw" not in req.url.pat…
    !57 "[refactor] ES Client async initialization with lifespan management"
        ## Summary

This MR refactors the Elasticsearch client initialization to use async patterns and adds ES API Gateway support for flexible deployment options.

### 🔄 ES Client Async Initialization
- Ch…
  Recent commits:
    f5950fb0 fix: remove redundant default value in pt mapping
    31814186 fix: sync mappings.py with legacy API
    07cbf37d fix: correct pt field mapping in textlist response
    5707492e refactor: centralize KwFieldType and add KwAggsType enum to shared schemas
    5e6035c5 refactor: replace KW_FIELD_VALUES TypeAlias with KwFieldType Enum
    6009b6f4 Merge branch 'fix/commentdist-async-execute' into 'develop'
    3343cac1 feat: sync commentdist with legacy API behavior
    413aa5f6 refactor: add _parse_date_with_format helper with semantic detection
    da5ebc65 fix: resolve params.method AttributeError in commentdist
    4fa6423d refactor: add kw_types validation and custom exceptions for trend_keywords

[KEYPO/keypo-frontend-2023]
  Open MRs:
    !139 "test(hashtagkw): add comprehensive E2E tests for HashtagKW page"
        ### 相關 Issue

基於 !138

### 這個 MR 做了什麼？

新增 HashtagKW 頁面 E2E 測試，沿用 LatestKW 測試的架構：

- **HashtagKW 測試** (`e2e/hashtagkw/hashtagkw.spec.ts`)：完整測試套件，涵蓋頁面存取、共用功能、產業類別選擇、圖表互動
- **HashtagKW 設定** (`e2e/hashta…
    !138 "feat(e2e): add comprehensive E2E test suite for LatestKW page"
        ### Related Issue(s)

Base on !137

### What does this MR do?

新增 LatestKW 頁面完整 E2E 測試套件與共用測試工具：

- **Chart Interaction Helpers** (`e2e/utils/chart-helpers.ts`): Highcharts 圖表互動工具，包含 bar/spline series…
    !136 "feat(e2e): add latestkw page E2E tests"
        ## Summary
- Add E2E test utilities for locale loading and path generation
- Add comprehensive E2E tests for `/latestkw` page (13 test cases)
- Fix WebKit secure cookie auth issue by setting NEXTAUTH_…
  Recent commits:
    4fff7d56 test: add E2E testing framework for main page
    924b2fad Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    b900be65 fix: update testIgnore configuration in Playwright settings
    031b942f Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    99ec8339 fix: update E2E UI test command
    9683b252 Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    a059ae70 fix: resolve session invalidation issue in parallel test execution
    3e52a7c8 Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    072d36fc ci: exclude -ui projects from E2E tests to fix session conflicts
    1d90631a fix: clear agent message when status changes #2917

[KEYPO/keypo-backend]
  Open MRs:
    !367 "fix(copilot): add user access control to prevent unauthorized data access"
        ## 🔴 CRITICAL SECURITY FIX

### Issue
Any authenticated user could access/modify other users' Copilot data by directly accessing UUIDs.

**Vulnerable Endpoints:**
- `GET /copilot/<uuid>` - Could read…
    !366 "[feat] Merge develop into master"
        * 修正 https://biglab.buygta.today/techcenter/reportcenter/-/issues/2857#note_83452
* 修正 https://biglab.buygta.today/techcenter/reportcenter_confidential/-/issues/288
* 修正 https://biglab.buygta.today/te…
    !364 "fix(cronjob): add active_date check in generate_sending_jobs"
        Prevent SendingJob creation for accounts whose active_date is in the future.
Also delete existing SendingJobs for such accounts.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
    !362 "fix(account): fix pop() bug preventing Settings sync to UserProfile"
        When updating RegionPermissionSetting, AllowSourceSetting, or
QueryRangeSetting via partial-update-company-group API, the related
UserProfile M2M fields were not being synchronized.

Changes:
- Add sy…
    !352 "fix(cronjob): sanitize Excel worksheet names to prevent save errors"
        ## Summary

- 修復 Excel 工作表名稱包含非法字元時儲存失敗的問題
- 將 `sanitize_excel_name` 函數提取到獨立的 `utils.py` 模組，方便測試和維護
- 新增完整的單元測試覆蓋所有非法字元

## Changes

- `cronjob/utils.py`: 新增純函數模組，包含 `sanitize_excel_name`
- `cronjob/c…
  Recent commits:
    0a4937fe Merge branch 'fix/copilot-user-access-control' into 'develop'
    1c0d421d fix(topic): comment out checkq validation during API Gateway migration
    fbd34cd2 fix(proxy): return empty result for invalid API responses
    10b339ef fix(middleware): skip sentimod when response is not valid dict
    3208ab60 fix(proxy): skip invalid API responses during gateway migration
    02b3d84c fix(api): skip 4xx errors during API Gateway migration
    6f4f3695 feat(api): migrate all KEYPO Engine API calls to API Gateway
    2ae6e053 fix(copilot): add user access control to prevent unauthorized data access
    b1620b76 Merge branch 'develop' into 'master'
    145445f0 Merge branch 'fix/issue-300-check-active-date-in-sending-job' into 'develop'

[KEYPO/keypo-engine-api]
  Open MRs:
    !558 "refactor(gpt): remove importlib.reload, use direct API params"
        - Change default api_order to ["openai", "azure"] (OpenAI as primary)
- Fix api_index initialization (0 instead of 1) and increment logic
- Remove global state mutation (openai.api_key, openai.api_bas…
    !557 "refactor(gpt): fix GPT Report fallback mechanism"
        ## Summary

- 移除 `importlib.reload(openai)` 反模式，改為直接傳遞 API 參數
- 修正 `api_order` 預設值為 `["openai", "azure"]`（OpenAI 優先，成本較低）
- 修正 `api_index` 初始化邏輯（從 0 開始）
- 新增 9 個單元測試驗證 fallback 機制

## Related Issue

h…
  Recent commits:
    e3063177 Merge branch 'fix/gpt-report-fallback' into 'develop'
    ef15db7c refactor(gpt): restore injectable params with None defaults

[KEYPO/keypo-engine/keypo-engine-api-gateway]
  Open MRs: (none)
  Recent commits:
    2687aa59 refactor: consolidate benchmark/stress tests into benchmarks/
    857bd198 refactor(config): unify routes config with template + env vars

[KEYPO/keypo-engine/on-premises-api-gateway]
  Open MRs: (none)
  Recent commits:
    da5f27be fix(config): add etcd auth and standardize configuration
    4532c271 fix(config): fix access log format and add health check route
    45be6485 docs: add API configuration guide and improve health checking

[KEYPO/keypo-engine/keypo-engine-gateway]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/data-collector]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/analyzer-and-qtool-testcase]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/qtool]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-newsletter]
  Open MRs: (none)
  Recent commits:
    ea3522d7 refactor(di): inject GeminiService via constructor

[KEYPO/keypo-international-website]
  Open MRs: (none)
  Recent commits:
    87276ae4 Merge branch 'develop'

[KEYPO/line-notify-backend-2023]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-data-api]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-q-huaan-v2]
  Open MRs:
    !25 "Add senti model"
        Add senti model
    !27 "Ad score"
    !26 "Add location"
  Recent commits:
    02b5e0b9 tweak location support
    01fdf7d4 Merge branch 'ad-score' into 'master'
    cb029f2e Ad score
    de6cf09c Merge branch 'add-location' into 'master'
    40ed97a4 Add location

[KEYPO/keypo-engine-layer]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-status-check]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-questionnaire]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-micro-portal]
  Open MRs: (none)
  Recent commits: (none)

```

**Baseline**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-newsletter",
    "KEYPO/keypo-backend"
  ],
  "suggested_assignees": [],
  "reasoning": "Issue 描述試用帳號到期後速報／日報仍持續發送的問題，核心邏輯涉及帳號有效期檢查與排程發信，最可能座落在 keypo-newsletter（負責速報／日報寄送排程）或 keypo-backend（負責帳號狀態與有效期管理）。",
  "confidence": 0.32,
  "caveats": [
    "冷啟動：無任何相似歷史 issue，路由完全依賴關鍵字語意推斷，信心分數偏低",
    "速報排程與帳號有效期檢查可能跨 newsletter / backend 兩個服務，需先確認帳號到期判斷邏輯究竟在哪個服務執行",
    "11/28 到期後日報持續到 12/5 才停止，顯示可能有快取或 job queue 延遲，建議同步排查排程 worker",
    "無歷史 assignee 資料，無法推薦負責人，請 triage 人員依組織知識手動指派"
  ],
  "error": null,
  "latency_ms": 28773,
  "prompt_chars": 3433
}
```

**Enriched**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-backend",
    "KEYPO/keypo-newsletter"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 核心症狀為試用帳號到期後仍持續發送速報、以及帳號尚未生效前即觸發排程發送，屬於 SendingJob 排程與帳號有效日期驗證的邏輯缺陷；keypo-backend 近期 MR !364（fix(cronjob): add active_date check in generate_sending_jobs，描述為「Prevent SendingJob creation for accounts whose active_date is in the future，Also delete existing SendingJobs for such accounts」）與本 issue 症狀高度吻合，為首要候選。keypo-newsletter 負責速報實際發送流程，若速報模組獨立於 backend cronjob，則亦需同步排查。",
  "confidence": 0.42,
  "caveats": [
    "無相似歷史 issue（cold start），信心分數依規則限制在 0.5 以下",
    "keypo-backend MR !364 與本 issue 症狀高度吻合，但需確認該 MR 是否為此 issue 的先行修復或僅是巧合相似",
    "issue 中同時提到『速報』與『日報』兩種排程類型，可能涉及不同發送路徑（cronjob vs newsletter 模組），triage 時需釐清兩者的程式碼歸屬",
    "帳號到期後延續發送至 12/5 的行為（共 7 天延遲停止）可能另有獨立 bug，與帳號延長後提前發送的問題需分開追蹤",
    "無歷史 assignee 資料，建議由 triage 人員依 MR !364 的作者或 cronjob 模組負責人指派"
  ],
  "error": null,
  "latency_ms": 35538,
  "prompt_chars": 14138
}
```

### Fixture 302 — 20260106 - 錯誤訊息顯示Unknown error

**Ground truth:** primary=`KEYPO/keypo-backend`, all=["KEYPO/keypo-backend"]
**Window:** since=`2026-01-21T03:33:02.438Z`, until=`2026-01-29T03:33:02.438Z` (anchored to closed_at=`2026-01-28T03:33:02.438Z`)

**Activity block (as injected):**
```
=== RECENT REPO ACTIVITY (for routing context) ===

[KEYPO/keypo-backend]
  Open MRs:
    !367 "fix(copilot): add user access control to prevent unauthorized data access"
        ## 🔴 CRITICAL SECURITY FIX

### Issue
Any authenticated user could access/modify other users' Copilot data by directly accessing UUIDs.

**Vulnerable Endpoints:**
- `GET /copilot/<uuid>` - Could read…
    !366 "[feat] Merge develop into master"
        * 修正 https://biglab.buygta.today/techcenter/reportcenter/-/issues/2857#note_83452
* 修正 https://biglab.buygta.today/techcenter/reportcenter_confidential/-/issues/288
* 修正 https://biglab.buygta.today/te…
    !364 "fix(cronjob): add active_date check in generate_sending_jobs"
        Prevent SendingJob creation for accounts whose active_date is in the future.
Also delete existing SendingJobs for such accounts.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
    !362 "fix(account): fix pop() bug preventing Settings sync to UserProfile"
        When updating RegionPermissionSetting, AllowSourceSetting, or
QueryRangeSetting via partial-update-company-group API, the related
UserProfile M2M fields were not being synchronized.

Changes:
- Add sy…
    !352 "fix(cronjob): sanitize Excel worksheet names to prevent save errors"
        ## Summary

- 修復 Excel 工作表名稱包含非法字元時儲存失敗的問題
- 將 `sanitize_excel_name` 函數提取到獨立的 `utils.py` 模組，方便測試和維護
- 新增完整的單元測試覆蓋所有非法字元

## Changes

- `cronjob/utils.py`: 新增純函數模組，包含 `sanitize_excel_name`
- `cronjob/c…
  Recent commits:
    0a4937fe Merge branch 'fix/copilot-user-access-control' into 'develop'
    1c0d421d fix(topic): comment out checkq validation during API Gateway migration
    fbd34cd2 fix(proxy): return empty result for invalid API responses
    10b339ef fix(middleware): skip sentimod when response is not valid dict
    3208ab60 fix(proxy): skip invalid API responses during gateway migration
    02b3d84c fix(api): skip 4xx errors during API Gateway migration
    6f4f3695 feat(api): migrate all KEYPO Engine API calls to API Gateway
    2ae6e053 fix(copilot): add user access control to prevent unauthorized data access
    b1620b76 Merge branch 'develop' into 'master'
    145445f0 Merge branch 'fix/issue-300-check-active-date-in-sending-job' into 'develop'

[KEYPO/keypo-engine-api]
  Open MRs:
    !558 "refactor(gpt): remove importlib.reload, use direct API params"
        - Change default api_order to ["openai", "azure"] (OpenAI as primary)
- Fix api_index initialization (0 instead of 1) and increment logic
- Remove global state mutation (openai.api_key, openai.api_bas…
    !557 "refactor(gpt): fix GPT Report fallback mechanism"
        ## Summary

- 移除 `importlib.reload(openai)` 反模式，改為直接傳遞 API 參數
- 修正 `api_order` 預設值為 `["openai", "azure"]`（OpenAI 優先，成本較低）
- 修正 `api_index` 初始化邏輯（從 0 開始）
- 新增 9 個單元測試驗證 fallback 機制

## Related Issue

h…
  Recent commits:
    e3063177 Merge branch 'fix/gpt-report-fallback' into 'develop'
    ef15db7c refactor(gpt): restore injectable params with None defaults

[llmprojects/keypo-agent]
  Open MRs:
    !33 "Release v2.0.0: Gemini Migration, Observability, and Architecture Improvements"
        ## Release Summary

Major release bringing LLM provider migration, comprehensive observability, and significant architecture improvements. This release includes 25 commits across 131 files with 3,201…
    !34 "refactor(workflow): restructure keyword workflow with dedicated repair step"
        ## Summary
- Extract keyword repair logic from build_step into dedicated repair_step for better separation of concerns
- Convert construct_query_string_tool from WorkflowTools wrapper to direct @tool…
    !29 "fix(integrations/keypo): respect user-provided settings without forced defaults"
        ## Summary
- Remove hardcoded default parameters that were overriding user-specified settings
- Fix agent behavior to respect user-provided `type`, `pt`, and `q_fields` values
- Ensure immutable/mutab…
    !31 "refactor: restructure agents to app/ai/keypo and migrate to Skills"
        ## Summary
- Restructured the entire agent architecture from `app/agents` to `app/ai/keypo` to better organize AI components by product
- Replaced VectorDB/preset questions system with 28 Agno Skills…
    !30 "fix(agents): pass API key explicitly to OpenAIModerationGuardrail"
        ## Summary

Fixes OpenAIModerationGuardrail initialization error where the API key was not being passed explicitly, causing it to fail when reading from environment variables.

## Changes

- Pass `api…
  Recent commits:
    00276533 Merge branch 'dev' into 'master'
    fc0b408c refactor(agents): migrate from OpenAI to Gemini 2.5 Flash
    27090794 refactor(agents): move all agent modules to keypo namespace
    b783e23a Merge branch 'refactor/keyword-workflow-with-repair' into 'dev'
    ba6b16a4 refactor(workflow): restructure keyword workflow with dedicated repair step
    c4d7c71c fix(agents/knowledge): replace hardcoded company name with dynamic topic_name in market trend template
    879521d5 refactor(conversation): update session state before team execution
    401cee44 Merge branch 'fix/agent-follow-user-setting' into 'dev'
    4b6c5c82 fix(integrations/keypo): respect user-provided settings without forced defaults
    56e529b2 fix(agents): correct template parameter name in analysis_agent

[KEYPO/keypo-engine/keypo-engine-api-gateway]
  Open MRs: (none)
  Recent commits:
    2687aa59 refactor: consolidate benchmark/stress tests into benchmarks/
    857bd198 refactor(config): unify routes config with template + env vars

[KEYPO/keypo-frontend-2023]
  Open MRs:
    !139 "test(hashtagkw): add comprehensive E2E tests for HashtagKW page"
        ### 相關 Issue

基於 !138

### 這個 MR 做了什麼？

新增 HashtagKW 頁面 E2E 測試，沿用 LatestKW 測試的架構：

- **HashtagKW 測試** (`e2e/hashtagkw/hashtagkw.spec.ts`)：完整測試套件，涵蓋頁面存取、共用功能、產業類別選擇、圖表互動
- **HashtagKW 設定** (`e2e/hashta…
    !138 "feat(e2e): add comprehensive E2E test suite for LatestKW page"
        ### Related Issue(s)

Base on !137

### What does this MR do?

新增 LatestKW 頁面完整 E2E 測試套件與共用測試工具：

- **Chart Interaction Helpers** (`e2e/utils/chart-helpers.ts`): Highcharts 圖表互動工具，包含 bar/spline series…
    !136 "feat(e2e): add latestkw page E2E tests"
        ## Summary
- Add E2E test utilities for locale loading and path generation
- Add comprehensive E2E tests for `/latestkw` page (13 test cases)
- Fix WebKit secure cookie auth issue by setting NEXTAUTH_…
  Recent commits:
    4fff7d56 test: add E2E testing framework for main page
    924b2fad Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    b900be65 fix: update testIgnore configuration in Playwright settings
    031b942f Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    99ec8339 fix: update E2E UI test command
    9683b252 Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    a059ae70 fix: resolve session invalidation issue in parallel test execution
    3e52a7c8 Merge branch 'feat-e2e-test-joe' into feat-e2e-test
    072d36fc ci: exclude -ui projects from E2E tests to fix session conflicts
    1d90631a fix: clear agent message when status changes #2917

[KEYPO/keypo-engine/keypo-engine-api-v3]
  Open MRs:
    !65 "fix: resolve commentdist feature issues and sync with legacy API"
        ## Summary

修復「相關聲量」(commentdist) 功能的 Server 500 錯誤，並與 Legacy API 行為同步。

### Commits

1. **fix: resolve params.method AttributeError in commentdist**
   - 將 `params.method not in ["v2/rapidkw"]` 改為 `"…
    !64 "fix: resolve commentdist feature issues and sync with legacy API"
        ## Summary

修復「相關聲量」(commentdist) 功能的 Server 500 錯誤，並與 Legacy API 行為同步。

### 修改內容

1. **Fix params.method AttributeError**
   - 將 `params.method not in ["v2/rapidkw"]` 改為 `"rapidkw" not in req.url.pat…
    !57 "[refactor] ES Client async initialization with lifespan management"
        ## Summary

This MR refactors the Elasticsearch client initialization to use async patterns and adds ES API Gateway support for flexible deployment options.

### 🔄 ES Client Async Initialization
- Ch…
  Recent commits:
    f5950fb0 fix: remove redundant default value in pt mapping
    31814186 fix: sync mappings.py with legacy API
    07cbf37d fix: correct pt field mapping in textlist response
    5707492e refactor: centralize KwFieldType and add KwAggsType enum to shared schemas
    5e6035c5 refactor: replace KW_FIELD_VALUES TypeAlias with KwFieldType Enum
    6009b6f4 Merge branch 'fix/commentdist-async-execute' into 'develop'
    3343cac1 feat: sync commentdist with legacy API behavior
    413aa5f6 refactor: add _parse_date_with_format helper with semantic detection
    da5ebc65 fix: resolve params.method AttributeError in commentdist
    4fa6423d refactor: add kw_types validation and custom exceptions for trend_keywords

[KEYPO/keypo-engine/on-premises-api-gateway]
  Open MRs: (none)
  Recent commits:
    da5f27be fix(config): add etcd auth and standardize configuration
    4532c271 fix(config): fix access log format and add health check route
    45be6485 docs: add API configuration guide and improve health checking

[KEYPO/keypo-engine/keypo-engine-gateway]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/data-collector]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/analyzer-and-qtool-testcase]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/qtool]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-newsletter]
  Open MRs: (none)
  Recent commits:
    ea3522d7 refactor(di): inject GeminiService via constructor

[KEYPO/line-notify-backend-2023]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-international-website]
  Open MRs: (none)
  Recent commits:
    87276ae4 Merge branch 'develop'

[KEYPO/keypo-data-api]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-q-huaan-v2]
  Open MRs:
    !25 "Add senti model"
        Add senti model
    !27 "Ad score"
    !26 "Add location"
  Recent commits:
    02b5e0b9 tweak location support
    01fdf7d4 Merge branch 'ad-score' into 'master'
    cb029f2e Ad score
    de6cf09c Merge branch 'add-location' into 'master'
    40ed97a4 Add location

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
  "reasoning": "Issue 帶有 K5 label，屬於 KEYPO 產品範疇；錯誤訊息「Unknown error」伴隨括號符號缺失的顯示問題，可能源自前端錯誤訊息格式化邏輯或後端回傳的原始 error string 未經處理，優先建議 frontend-2023，次要懷疑 backend / engine-api。",
  "confidence": 0.28,
  "caveats": [
    "冷啟動：無任何相似歷史 issue，路由純靠 label 與描述推斷，信心偏低。",
    "截圖 /uploads/08b7e5f7… 無法取得，實際錯誤 UI 細節未知，可能影響判斷層級（前端渲染 vs 後端回傳）。",
    "無歷史 assignee 資料，建議 triage 人員依當前 on-call 或模組負責人手動指派。",
    "issue 來源 project 為 techcenter/reportcenter_confidential，需確認該 report center 功能是否有獨立子 repo 而非上列 KEYPO 群組 repo。"
  ],
  "error": null,
  "latency_ms": 24322,
  "prompt_chars": 3147
}
```

**Enriched**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "KEYPO/keypo-frontend-2023",
    "KEYPO/keypo-backend"
  ],
  "suggested_assignees": [],
  "reasoning": "Issue 標籤為 K5，屬 KEYPO 產品範疇；錯誤訊息格式錯誤（左括號與字詞間缺少連接符號）多為前端渲染或後端錯誤訊息組裝問題，keypo-frontend-2023 負責 UI 呈現，keypo-backend 近期 MR !366 也明確修正 reportcenter_confidential 的 issue，兩者皆為強候選。",
  "confidence": 0.3,
  "caveats": [
    "冷啟動：無相似歷史 issue，無法從過去 assignee 頻率推薦負責人，請 triage 人員依團隊分工手動指派。",
    "錯誤訊息截圖無法讀取（GitLab 附件），實際的 Unknown error 內容與觸發路徑未知，可能涉及 API 層（keypo-engine-api-v3 或 keypo-engine-api）而非純前後端問題。",
    "issue 來源 project 為 techcenter/reportcenter_confidential，建議確認此功能對應的實際 KEYPO 模組後再路由。"
  ],
  "error": null,
  "latency_ms": 31514,
  "prompt_chars": 13852
}
```

### Fixture 304 — 20260108 - 某客戶_聲量有超出100筆的聲量數值，不過AI報告顯示聲量不足，暫時無法提供精確的GPT分析結果

**Ground truth:** primary=`KEYPO/keypo-engine-api`, all=["KEYPO/keypo-engine-api"]
**Window:** since=`2026-02-04T03:21:43.736Z`, until=`2026-02-12T03:21:43.736Z` (anchored to closed_at=`2026-02-11T03:21:43.736Z`)

**Activity block (as injected):**
```
=== RECENT REPO ACTIVITY (for routing context) ===

[KEYPO/keypo-backend]
  Open MRs: (none)
  Recent commits:
    ff8074e6 Revert "fix(topic): comment out checkq validation during API Gateway migration"

[KEYPO/keypo-frontend-2023]
  Open MRs: (none)
  Recent commits:
    e734b448 fix: remove incorrect row count from notification DataGrid
    e8c0e28b refactor: handle additional HTML doctype variations in error checks
    663964e4 fix: memoise query date in index page components
    3dc0821b test(e2e): restructure main page tests for better organization
    eb98e55c refactor(e2e): improve MUI helper reliability and error handling
    9270ba90 test(config): add NEXTAUTH_URL to Playwright environment
    5c157c2c test(e2e): refactor main page tests for better reliability
    b8e02411 docs: add release notes for v1.6.4
    eb7778be Merge branch 'develop'
    8d56ce2c v1.6.4

[KEYPO/keypo-engine/on-premises-api-gateway]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/keypo-engine-api-gateway]
  Open MRs:
    !23 "docs(openapi): add internal connection info for developers"
        ## Summary
- 在 OpenAPI spec 的 info.description 加入連線方式表格
- 包含外部 (Internet)、內部 VPC Staging/Production 連線資訊
- Production Internal LB 標示暫無，待部署後補上

## Changes
- `docs/openapi.yaml`: 新增「連線方式」表格，提供 Internal…
    !22 "feat(ci): add GitLab Pages for OpenAPI docs"
        ## Summary
- 新增 GitLab Pages job，merge to develop/main 時自動生成 Swagger UI
- 測試 Pages 是否正常運作

## Changes
- `.gitlab-ci.yml`: 新增 `pages` stage + job
- `scripts/generate_openapi_html.py`: 支援 `--env`, `--se…
    !21 "fix(routes): add _meta.error_response to key-auth services"
        ## Summary
- 401 回應缺少 `error` 欄位，不符合 OpenAPI spec 和 ADR-012
- 三個 service 的 key-auth 加上 `_meta.error_response`

## Changes
- `apisix_conf/routes.yaml.tpl`: svc-v3, svc-v2-mock, svc-mock 加 `_meta.error_…
    !20 "feat(ci): mask API keys in backups and commit to repo"
        ## Summary
- Backup dumps 的 API keys 改用 `${VAR_NAME}` 遮碼，安全 commit 回 repo
- 從 CI artifact 改回 git commit（keys 已遮碼）

## Changes
- `scripts/dump_config.py`: 新增 `--mask-keys` 參數，把 consumer `key-auth.key`…
    !19 "fix(ci): force-add backup file ignored by .gitignore"
        ## Summary
- `git add` in CI fails because `backups/` is in `.gitignore`
- Use `git add -f` to force-add since CI intentionally commits backups

## Changes
- `scripts/commit_backup.sh`: `git add` → `g…
  Recent commits:
    ab098f1d feat(scripts): add nginx-bypass operations script and runbook
    3e206ba7 feat(helm): add nginx-bypass proxy for temporary gateway bypass
    94d3b845 docs: add nginx bypass gateway design
    52b2f955 refactor(docs): reorganize docs into tutorials/sop/runbooks/reports structure
    f5307165 backup(staging): before sync 0.0.2-beta.5 [skip ci]
    026e15bc Merge branch 'docs/openapi-connection-info' into 'develop'
    4e1a8422 docs(openapi): add internal connection info for developers
    42bd8e8d fix(ci): fallback to develop openapi.yaml when main has none
    f28d9308 refactor(ci): move pages landing to docs/pages-index.html
    eb408765 feat(ci): generate both staging and production OpenAPI docs

[KEYPO/keypo-engine-api]
  Open MRs:
    !559 "feat(article_core): add GetContentByRef API endpoint"
        ## Summary

- 新增 `POST /getcontentbyref` API，透過 ES `_id` 取得單篇文章完整內容，支援關鍵字高亮
- 修正 `BaseQueryModel` 的 `pt` 欄位為 optional，與 legacy API 行為一致

## Changes

### fix(shared): make pt field optional in BaseQuer…
  Recent commits: (none)

[llmprojects/keypo-agent]
  Open MRs:
    !42 "feat(pdf): add CJK PDF report generation with structured content model and active storage integration"
        ### What does this MR do?

Adds end-to-end PDF report generation for the analysis agent. Users can now request analysis reports (e.g., "generate a report") and receive a structured PDF with CJK text,…
    !37 "Draft: feat: test reasoning event"
    !32 "refactor: Replace VectorDB and preset questions with Agno Skills"
        ### MR Title:

refactor: Replace VectorDB and preset questions with Agno Skills

### Related Issue(s):

N/A

### What does this MR do?

This MR refactors the analysis scenario system from a hybrid app…
    !40 "refactor(agents): replace preset questions with analysis plan agent and add active storage"
        ## What does this MR do?

This MR introduces two major architectural changes:

1. **Analysis plan agent** -- Replaces the hardcoded preset question system with a dynamic `AnalysisPlanAgent` that gener…
    !41 "refactor(events): consolidate event architecture with polymorphic formatting"
        ## Summary

Consolidate scattered `CustomEvent` subclasses from individual tool files into a single `app/agents/keypo/events.py` module with a `BaseEvent` base class. Each event subclass now implement…
  Recent commits:
    ec626398 feat(events): add run_id to AgentEvent model
    dc9ef5a3 Merge branch 'feature/cjk-pdf-report' into 'dev'
    1944ce78 feat(pdf): add CJK PDF report generation with structured content model and active storage integration
    f9ad5638 Merge branch 'dev' into 'master'
    28a2a45f feat(agents): inject user settings into prompt
    532057a8 Merge branch 'refactor/event-architecture' into 'dev'
    03c97b95 refactor(events): consolidate event architecture with polymorphic formatting
    a8659cd0 Merge branch 'refactor/determine-daterange' into 'dev'
    e0f2f773 refactor: consolidate date range detection and implement active storage download endpoint

[KEYPO/keypo-engine/keypo-engine-gateway]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/keypo-engine-api-v3]
  Open MRs:
    !8 "article-core--textlist"
    !69 "fix: resolve freqdist _msearch 403 error by passing index to MultiSearch"
        ## Summary

- **Root Cause**: `AsyncMultiSearch` was created without `index` parameter, causing ES Gateway to reject `_msearch` requests with `403 OPERATION_NOT_ALLOWED` (Gateway requires index in URL…
    !68 "fix: resolve AttrDict .get() AttributeError in textlist"
        ## Summary
- elasticsearch-dsl 8.x 的 `AttrDict` 不支援 `.get()` 方法，導致 `textlist` API 回傳 `AttributeError`
- 在迴圈入口統一使用 `doc.to_dict()` 將 AttrDict 轉為普通 dict
- 移除 `get_highlight()` 內多餘的 `doc.to_dict()` 呼叫（因傳…
    !67 "feat(common): add checkq API for query syntax validation"
        Add POST /checkq endpoint that validates query string syntax
using Qtool.checkq(). Returns "ok" on success or JSON error
with message and error_code on validation failure.

- Add CheckqPayload and Che…
  Recent commits:
    1133c9b7 chore(shared): update OutputFormatMiddleware DEFAULT_VERSION to v3
    84219db7 feat(shared): add OutputFormatMiddleware for legacy API compatibility
    e8121f32 fix(article_core): implement keyword highlighting in GetContentByRef
    774f6042 fix(shared): add default value for q_fields in BaseQueryModel
    ab2bec1f Merge branch 'fix/freqdist-msearch-error' into 'develop'
    071acdf7 Merge branch 'fix/attrdict-get-method' into 'develop'
    d0b7037e feat(article_core): add GetContentByRef API endpoint
    e53d4a78 fix(shared): make pt field optional in BaseQueryModel
    0350c245 refactor: remove debug print from freqdist use case
    eed61467 fix: resolve freqdist _msearch 403 error by passing index to MultiSearch

[KEYPO/keypo-engine/data-collector]
  Open MRs: (none)
  Recent commits:
    ba698dc9 update correction.txt
    2e472070 fix: fix error fields is not treat as failed in _resolve_es_task_status()
    7a35ae97 feat: add reindex task tracker with ES Tasks API integration
    b729fd9e refactor: create ES clients locally with proper lifecycle management
    e0574b38 fix lint issue

[KEYPO/keypo-engine/analyzer-and-qtool-testcase]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine/qtool]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-newsletter]
  Open MRs:
    !33 "fix(ui): use dynamic copyright year and remove hardcoded AI summary prefix"
        - Dashboard copyright year now uses Django {% now "Y" %} instead of hardcoded 2025
- AI summary title renders directly from DB field, removing hardcoded「【AI 摘要】」prefix
- Auto-create default AISummaryG…
    !17 "refactor(config): consolidate domain URLs to BASE_DOMAIN_URL"
        ### Related Issue(s):
Closes #5

### What does this MR do?

Consolidates all domain-related URL settings into a single environment variable `BASE_DOMAIN_URL` to simplify environment management across…
    !32 "fix(ui): use dynamic copyright year and remove hardcoded AI summary prefix"
        - Dashboard copyright year now uses Django {% now "Y" %} instead of hardcoded 2025
- AI summary title renders directly from DB field, removing hardcoded「【AI 摘要】」prefix
- Auto-create default AISummaryG…
    !31 "fix(ui): use dynamic copyright year and remove hardcoded AI summary prefix"
        - Dashboard copyright year now uses Django {% now "Y" %} instead of hardcoded 2025
- AI summary title renders directly from DB field, removing hardcoded「【AI 摘要】」prefix
- Auto-create default AISummaryG…
    !30 "feat(newsletter): add configurable AI summary groups"
        - Add AISummaryGroup model with source filtering and ordering
- Deprecate NewsletterSetting.ai_summary in favor of groups
- Refactor _generate_ai_summary() to return list of summaries
- Add _generate_…
  Recent commits:
    a0b3629e Merge branch 'develop' into 'main'
    70dda88b Merge branch 'fix/ui-text-improvements' into 'develop'
    e14bbbba fix(config): require NEWSLETTER_DOWNLOAD_URL from env, no default
    455ecb24 Merge branch 'fix/ui-text-improvements' into 'develop'
    3851f5ad fix(ui): use dynamic copyright year and remove hardcoded AI summary prefix
    84be7fc7 Merge branch 'develop' into 'main'
    ef7c65c1 Merge branch 'fix/typo-company-name' into 'develop'
    6d525c86 fix(content): correct company name typo in disclaimer text
    8ccbec87 Merge branch 'feature/configurable-ai-summary-retry' into 'develop'

[KEYPO/keypo-international-website]
  Open MRs: (none)
  Recent commits:
    80423f0e Merge branch 'fix-locale-routing-jp-path' into develop
    f6687226 refactor: extract HTML shell to root layout and add 404 handling
    253b48a5 Merge branch 'develop'
    aebdea3e Merge branch 'fix-locale-routing-jp-path' into develop
    12f57976 refactor: adjust height of DesktopNavbar and related layout components
    864f0ca0 feat: add Japanese banner images
    3cdf7512 Merge branch 'develop'
    830a3a92 Merge branch 'fix-locale-routing-jp-path' into develop
    66fe09bc fix: update YouTube embed link for Japanese locale in KeyEngine
    2a6ce66c feat: add redirects for '/ja' to '/jp' in next.config.js

[KEYPO/line-notify-backend-2023]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-engine-layer]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-questionnaire]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-q-huaan-v2]
  Open MRs:
    !31 "Add ae datapipeline"
    !29 "add retry"
  Recent commits:
    ef204d88 Merge branch 'add-ae-datapipeline' into 'master'
    ed4dc4f0 Add ae datapipeline
    8c8bf298 update rmq to 4.2.3
    1e04dc7b tweaks
    4c7bdf7c Merge branch 'add-retry' into 'master'
    9fdc797c add retry

[KEYPO/keypo-data-api]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-status-check]
  Open MRs: (none)
  Recent commits: (none)

[KEYPO/keypo-micro-portal]
  Open MRs: (none)
  Recent commits: (none)

```

**Baseline**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "llmprojects/keypo-agent",
    "KEYPO/keypo-backend",
    "KEYPO/keypo-engine-api"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 同時帶有 K5 與 Data 標籤，問題核心是 AI 報告在聲量充足（36,720 筆）時仍誤判為「聲量不足」並跳過 GPT 分析，推測門檻判斷邏輯位於 llmprojects/keypo-agent 或 keypo-backend 的報告生成流程，且客戶帳號與管理員帳號行為不一致暗示可能有帳號層快取或時序問題。",
  "confidence": 0.32,
  "caveats": [
    "冷啟動：無相似歷史 issue，路由完全依賴標籤組合與 issue 描述推斷，信心偏低",
    "客戶帳號 jessicachi 與管理員帳號在不同時間點行為不一致（客戶 09:20 失敗，管理員 11:02 正常），需確認是帳號權限差異、查詢快取過期還是 AI 報告生成競態條件",
    "Data 標籤可能指向 CrawlersV2 資料管道在該時段的即時性問題，triage 人員應交叉確認 1/6–1/9 期間爬取狀態是否正常",
    "suggested_assignees 為空，因無歷史 assignee 資料可參考，建議 triage 人員依內部輪值或 on-call 指派"
  ],
  "error": null,
  "latency_ms": 31014,
  "prompt_chars": 5062
}
```

**Enriched**:
```json
{
  "layer": "n/a",
  "suggested_repos": [
    "llmprojects/keypo-agent",
    "KEYPO/keypo-backend",
    "KEYPO/keypo-engine-api-v3"
  ],
  "suggested_assignees": [],
  "reasoning": "此 issue 核心症狀為 AI 報告誤判聲量不足（實際 36k+ 筆），且同一時段不同帳號結果不同，高度指向 AI 分析層的帳號設定或閾值邏輯問題；`llmprojects/keypo-agent` 近期有 `feat(agents): inject user settings into prompt` 與 PDF 報告生成 MR，與帳號差異造成 GPT 分析結果不同的症狀吻合，為首選；`KEYPO/keypo-backend` 為次要懷疑（後端可能在送 AI 前做聲量閾值判斷），`KEYPO/keypo-engine-api-v3` 則負責資料查詢層，若資料計數在 API 端就算錯也可能觸發此問題。",
  "confidence": 0.32,
  "caveats": [
    "冷啟動 (cold start)：無任何相似歷史 issue，信心分數偏低",
    "無歷史 assignee 資料，無法推薦負責人，需 triage 人員根據 keypo-agent / keypo-backend 團隊歸屬手動指派",
    "症狀具帳號特異性（jessicachi 異常、Joanne 正常），排查時應優先比對兩帳號的 user settings / 訂閱設定差異",
    "techcenter/reportcenter_confidential 為來源 project，但該 repo 不在 K5 label 的 known_exceptions 列表中，建議確認問題是否源自 reportcenter 本身的 AI 呼叫邏輯，而非 keypo-agent"
  ],
  "error": null,
  "latency_ms": 37278,
  "prompt_chars": 16746
}
```
