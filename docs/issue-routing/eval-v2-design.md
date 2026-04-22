# Eval v2 — Closed-Loop Optimization System for Issue Routing

> Status: Design (approved decisions locked)
> Audience: IC / 工程主管 / 任何負責 issue routing prompt tuning 的人
> 配套文件: [`README.md`](./README.md), [`OPERATIONS.md`](./OPERATIONS.md)
> 前期 context: `test/eval/` (B4 synthetic fixtures, commit 8023674), `docs/superpowers/plans/2026-04-22-issue-routing.md`

Eval v2 是 issue routing 系統的 **closed-loop optimization infrastructure** — 從真實歷史 issue 自動萃取 ground truth、跑 multi-metric eval、在控制的 train/test split 上做 prompt iteration、最後 cross-label transfer 到 BD / DV / Fanti / Data / 信義。本文件 formalize user-approved 決策並列出完整 4-phase 架構、data model、metrics 定義、bias 防線、風險與驗收標準。

---

## 1. Purpose — 為什麼 eval v2 ≠ B4 synthetic

### 1.1 B4 (existing) 做了什麼

`test/eval/` 下 14 個手寫 synthetic fixtures (`k5-agent-*`, `bd-*`, `fanti-*`, ...),每個 fixture 描述一個 anonymized issue 加上 expected routing outcome,runner 對 Phase 1 + Phase 2 LLM pipeline 做 assertion:

- `phase1.layer` 精確匹配
- `phase1.suggested_repos` 與 `expected_repos_any_of` 交集非空
- `phase1.confidence` 落在預期 band
- `phase2.plan_draft` 存在性符合 `plan_draft_required`

Pass rate ≥ 90% 才 exit 0。這是一個 **regression gate**:確保 prompt change 不把已知 case 打壞。

### 1.2 B4 解不了的問題

| 問題 | B4 現狀 | Eval v2 需要做到 |
|------|---------|------------------|
| Fixtures 的代表性 | 人手寫 14 個 case,作者偏見 | 從 closed issue pool sample 100 個,coverage 由分布反映現實 |
| Ground truth 來源 | 作者判斷 (可能錯) | 多信號 ensemble(MR cross-ref + assignee heuristic + LLM comment reader) |
| Plan 品質怎麼量 | 只有 `plan_draft != null` (binary) | Cross-family judge (sonnet-4-5) 給 rubric-based 1-5 分 |
| 過擬合偵測 | 無 — 所有 fixture 都參與評分 | 70/30 train/test by close date,held-out test 才算 ship gate |
| Prompt iteration 的方向 | 人看 failing fixtures 憑感覺改 | Per-metric breakdown + per-iteration log,data-driven |
| 跨 label 轉移 | K5 prompt 通用,沒驗過其他 label | 分別驗證 K5 / BD / DV / Fanti / Data / 信義 各自的 performance |

**結論:eval v2 是 B4 的 superset,coexists 而非替代**。B4 synthetic fixtures 仍然留在 `test/eval/fixtures/` 做 PR-level regression (cheap, fast, lint-friendly);v2 的 GOLD set + iteration log 另外存於 `test/eval/gold/` 與 `test/eval/runs/`。

---

## 2. Architecture — Four Phases

```
                  ┌──────────────────────────────────────────────┐
                  │                 EVAL V2 PIPELINE             │
                  └──────────────────────────────────────────────┘

┌─────────────────┐   Phase I: Ground Truth Extraction
│ GitLab archive  │   ────────────────────────────────
│ (closed issues  │        ┌─────────────────────────────────────┐
│  2026-01-01→    │───────▶│ tiered ensemble (≥2/3 agree → GOLD) │
│  today, K5)     │        │  ├─ signal A: MR cross-reference    │
└─────────────────┘        │  ├─ signal B: assignee heuristic    │
                           │  └─ signal C: LLM comment reader    │
                           │                 (sonnet-4-6)        │
                           └─────────────────────────────────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │ test/eval/gold/K5/   │
                              │  <n=100 fixtures>    │
                              │  + provenance.json   │
                              └──────────────────────┘
                                         │
                                         ├─── 70/30 split by close date ───┐
                                         ▼                                 ▼
                               ┌────────────────┐                ┌─────────────────┐
                               │  TRAIN (~70)   │                │  TEST  (~30)    │
                               │  earliest→mid  │                │  most recent    │
                               └────────────────┘                └─────────────────┘
                                         │                                 │
                   Phase II: Multi-Metric Eval Harness                     │
                   ─────────────────────────────────                       │
                                         ▼                                 │
                           ┌──────────────────────────────┐                │
                           │ run Phase 1+2 LLM pipeline   │                │
                           │ on each TRAIN fixture        │                │
                           └──────────────────────────────┘                │
                                         │                                 │
                                         ▼                                 │
                           ┌──────────────────────────────┐                │
                           │ compute metrics:             │                │
                           │  ├─ routing P@1 / R@3        │                │
                           │  ├─ assignee R@3             │                │
                           │  ├─ confidence ECE           │                │
                           │  └─ cross-repo recall        │                │
                           └──────────────────────────────┘                │
                                         │                                 │
                                         ▼                                 │
                           ┌──────────────────────────────┐                │
                           │ cross-family judge           │                │
                           │ (claude CLI, sonnet-4-5):    │                │
                           │  plan quality rubric 1-5     │                │
                           │  across 4 dimensions         │                │
                           └──────────────────────────────┘                │
                                         │                                 │
                                         ▼                                 │
                           ┌──────────────────────────────┐                │
                           │ iteration_log_<N>.json       │                │
                           └──────────────────────────────┘                │
                                         │                                 │
                   Phase III: Controlled Optimization Loop                 │
                   ───────────────────────────────────────                 │
                                         ▼                                 │
                    ┌──────────────────────────────────────┐               │
                    │ for iter in 1..10:                   │               │
                    │   propose ONE prompt change          │               │
                    │   re-run TRAIN eval                  │               │
                    │   if ΔR@3 < 0 or Δjudge < 0          │               │
                    │     revert change                    │               │
                    │   else accept, log delta             │               │
                    │   early stop if 2 consecutive ~0     │               │
                    └──────────────────────────────────────┘               │
                                         │                                 │
                                         ▼                                 │
                               ┌────────────────────┐                      │
                               │ final TRAIN prompt │                      │
                               └────────────────────┘                      │
                                         │                                 │
                                         └──── final eval on TEST ─────────┤
                                                                           ▼
                                                            ┌──────────────────────┐
                                                            │  PRODUCTION GATE     │
                                                            │  R@3 ≥ 70% AND       │
                                                            │  judge avg ≥ 3.5/5   │
                                                            │  on HELD-OUT TEST    │
                                                            └──────────────────────┘
                                                                       │
                                                                       ▼
                   Phase IV: Cross-Label Transfer                 ┌──────────┐
                   ──────────────────────────                     │  SHIP    │
                           │                                      └──────────┘
                           ▼ (apply final K5 prompt template to)
                   ┌──────────────────────────────────────┐
                   │ BD / DV / Fanti / Data / 信義        │
                   │ repeat Phase I–III per-label         │
                   │ variance across labels → tuning hint │
                   └──────────────────────────────────────┘
```

### 2.1 Phase I — Ground Truth Extraction

**Input:** closed issues in `techcenter/reportcenter` + `techcenter/reportcenter_confidential` with label `K5`, closed on `[2026-01-01, today]`.

**Tiered ensemble extractor** — 每個 issue 三個獨立 signal,**≥ 2/3 agree** 才提升為 GOLD:

| Signal | 邏輯 | 失敗模式 |
|--------|------|----------|
| **A — MR cross-reference** | 解析 `Closes #<iid>` / `Related: !<MR-iid>` / commit trailer 指回 issue 的 MR;取 MR 的 target project → `routing_repos`;取 MR author/merger → `assignee`. | 有些 issue 純 ops 解 (config change),無對應 MR;或 MR 跨多 repo。 |
| **B — Assignee heuristic** | 讀 GitLab issue 的 `assignees` field + comment thread 最後一個 commit 被 attribute 到誰;結合 `config/label-routing.yaml` 的 primary_group 推斷 repo. | Assignee 常是 triage lead 非實際解法者;repo 推斷可能與實際分歧。 |
| **C — LLM comment reader** | 跑 Sonnet 4.6 (注意: 和 judge 的 sonnet-4-5 刻意不同 — 避免 extractor/judge 同族共振) 讀 issue body + 所有 comment,抽出 `resolution_summary` + `canonical_repo` + `canonical_assignee`. Prompt 中明示「不是 triage label,是實際 resolve 的 repo」. | LLM hallucination; comment thread 含雜訊 (狀態更新、閒聊) 時信號稀釋。 |

**Agreement rule**:三個 signal 對 `(repo, assignee)` 投票,取 majority 的 tuple 作為 GOLD。若 3 票全歧異 → `unresolved`,不進 GOLD (寫入 `rejected.json` 附原因)。**人工審核 = 0%**;若 rejected rate > 40%,Open Question #1 升級為 blocker,另起 session 討論是否加人工。

**Provenance**:每個 GOLD fixture 都必須帶 `provenance` 物件,記錄三個 signal 各自給什麼答案、agreement 如何達成、提取時間戳、extractor 版本。這是 v2 對 B4 的關鍵升級——任何未來 audit 都能 trace 回原始信號。

**Sample size**: `n = 100`(K5),從上述時間窗隨機 sample(seed 固定以利 reproducibility)。若候選池 < 100 → 全量取用並降級 n,run config 註記 `sample_exhausted: true`。

### 2.2 Phase II — Multi-Metric Eval Harness

沿用 `test/eval/run-eval.mjs` 框架,但新增:

- `test/eval/run-eval-v2.mjs` — v2 entry,讀 `test/eval/gold/<label>/*.json` 而非 synthetic fixtures
- `test/eval/judge-cli.mjs` — wraps `claude --print --model sonnet-4-5`,stdin 塞 rubric prompt,stdout parse JSON score
- `test/eval/metrics.mjs` — 純函式層,給定 `phase1`, `phase2`, `gold` → 回傳 metric bundle

Runner 對每個 fixture 跑 Phase 1 (routing) + Phase 2 (plan),存 raw output 到 `test/eval/runs/<run-id>/raw/<fixture-id>.json`,再計算 aggregate metrics 寫到 `test/eval/runs/<run-id>/metrics.json`。

### 2.3 Phase III — Controlled Optimization Loop

**Hard rules**:

1. **Single-change rule** — 每個 iteration **只改一個 prompt knob**(system message、few-shot example、tool signature、confidence floor...),log 明確記錄改了什麼。
2. **Revert-if-no-improvement** — 新 prompt 跑 TRAIN eval 後,**任一** primary metric (R@3, judge avg) 比上一版退步 → 自動 revert。
3. **Early stop** — 連續 2 次 iteration 沒有 ≥ +1pp R@3 或 +0.1 judge 改進 → stop。
4. **Iteration budget = 10** — 超過 10 即便還在改進也停,避免 train-set overfitting。
5. **TEST set 封存** — 整個 Phase III 期間 **不能** 看 TEST 數字;只有 final 版本出爐才跑一次 TEST eval 作 gate。

### 2.4 Phase IV — Cross-Label Transfer

K5 的 final prompt template 作為起點,套到 BD / DV / Fanti / Data / 信義 各自的 GOLD set(Phase I 在 K5 完成後對每個 label 分別跑一次),然後每個 label 獨立跑 Phase II–III。

**Variance hint**:若某 label 的 iteration log 顯示反覆在同一個 knob 打轉,或 R@3 始終卡在 < 60%,就是一個信號告訴我們「K5 assumption 不 generalize 到這個 label」,需要 per-label prompt 分支而非 unified template (見 Open Question #2)。

---

## 3. Data Model

### 3.1 GOLD fixture schema

儲存於 `test/eval/gold/<label>/<fixture-id>.json`。

```jsonc
{
  "id": "K5-0042",
  "label": "K5",
  "source": {
    "project_path": "techcenter/reportcenter",
    "issue_iid": 8317,
    "closed_at": "2026-02-14T09:12:33+08:00"
  },
  "issue": {
    "title": "<anonymized>",
    "description": "<anonymized>",
    "labels": ["K5", "Bug", "P2_中"],
    "state": "closed"
  },
  "gold": {
    "routing_repos": ["llmprojects/keypo-agent"],
    "assignees": ["henry.lee"],
    "layer": null,
    "resolution_summary": "<one-line gist from LLM signal C>"
  },
  "provenance": {
    "signal_A_mr_crossref": { "repos": ["llmprojects/keypo-agent"], "assignees": ["henry.lee"], "mr_iids": [2231] },
    "signal_B_assignee_heuristic": { "repos": ["llmprojects/keypo-agent"], "assignees": ["henry.lee"] },
    "signal_C_llm_comment_reader": {
      "repos": ["llmprojects/keypo-agent"],
      "assignees": ["henry.lee"],
      "model": "claude-sonnet-4-6",
      "prompt_hash": "sha256:8f3..."
    },
    "agreement": "3/3",
    "extracted_at": "2026-04-21T14:22:11+08:00",
    "extractor_version": "v2.0.0"
  },
  "split": "train"   // or "test"
}
```

### 3.2 Eval run schema

儲存於 `test/eval/runs/<run-id>/metrics.json`(`run-id = YYYYMMDD-HHMM-<label>-iterN`)。

```jsonc
{
  "run_id": "20260421-1430-K5-iter03",
  "label": "K5",
  "split": "train",
  "n_fixtures": 70,
  "iteration": 3,
  "prompt_version": "v2.0.0-iter03",
  "prompt_delta": "added 2-shot example for agent-vs-infra disambiguation",
  "metrics": {
    "routing_p_at_1": 0.657,
    "routing_r_at_3": 0.786,
    "assignee_r_at_3": 0.614,
    "confidence_ece": 0.083,
    "plan_judge_avg": 3.72,
    "plan_judge_breakdown": {
      "relevance": 4.1,
      "actionability": 3.5,
      "correctness": 3.9,
      "coverage": 3.4
    },
    "cross_repo_recall": 0.82
  },
  "per_issue": [
    {
      "fixture_id": "K5-0042",
      "phase1": { "suggested_repos": [...], "suggested_assignees": [...], "confidence": 0.78 },
      "phase2": { "plan_draft": "..." },
      "hit_p_at_1": true,
      "hit_r_at_3": true,
      "judge_scores": { "relevance": 4, "actionability": 4, "correctness": 4, "coverage": 3 }
    }
    // ... 69 more
  ],
  "started_at": "2026-04-21T14:30:02+08:00",
  "completed_at": "2026-04-21T14:41:55+08:00",
  "cost_usd": 2.14
}
```

### 3.3 Iteration log schema

儲存於 `test/eval/runs/<label>-iterations.json`(append-only)。

```jsonc
{
  "label": "K5",
  "iterations": [
    {
      "n": 0,
      "prompt_version": "v2.0.0-baseline",
      "delta": "initial port of B4 prompt to v2 harness",
      "train_metrics": { "routing_r_at_3": 0.71, "plan_judge_avg": 3.4 },
      "accepted": true
    },
    {
      "n": 1,
      "prompt_version": "v2.0.0-iter01",
      "delta": "added confidence floor 0.45 → 0.55 for known_exception paths",
      "train_metrics": { "routing_r_at_3": 0.73, "plan_judge_avg": 3.4 },
      "accepted": true,
      "rationale": "+2pp R@3, judge flat; keeping"
    },
    {
      "n": 2,
      "prompt_version": "v2.0.0-iter02",
      "delta": "rewrote system message to emphasize layer-first routing",
      "train_metrics": { "routing_r_at_3": 0.69, "plan_judge_avg": 3.3 },
      "accepted": false,
      "rationale": "R@3 regressed 4pp, reverted"
    }
    // ...
  ],
  "final_iteration": 7,
  "final_test_metrics": { "routing_r_at_3": 0.74, "plan_judge_avg": 3.61 },
  "gate_passed": true
}
```

---

## 4. Metrics — Precise Definitions

### 4.1 Routing P@1, R@3

給 issue `i`,模型回傳 ranked list `R_i = [r1, r2, r3, ...]`(`phase1.suggested_repos`,依 confidence 排序),GOLD 為 `G_i ⊆ Repos`。

| Metric | Formula | Ties rule |
|--------|---------|-----------|
| **P@1** | `|{i : r1_i ∈ G_i}| / N` | 若 model 回傳多個 top-1 (同 confidence),取 lexical 最小的當 r1(deterministic)。 |
| **R@3** | `|{i : R_i[0..3] ∩ G_i ≠ ∅}| / N` | 若 list 短於 3 個,用實際長度;`|G_i| > 1` 時只要命中一個即算 hit。 |

### 4.2 Assignee R@3

同結構,改比對 `phase1.suggested_assignees` 前 3 個與 `gold.assignees`。若 fixture `gold.assignees = []` → 該 fixture 不計入(denom 減一)。

### 4.3 Confidence Calibration — ECE

Expected Calibration Error(10-bin equal-width):

```
ECE = Σ_{b=1..10} (|B_b| / N) × |acc(B_b) − conf(B_b)|
```

其中 `B_b` 是 confidence 落在 `[(b-1)/10, b/10)` 的 fixture 集合,`acc(B_b)` = R@3 hit rate in bucket,`conf(B_b)` = bucket mean confidence。**Target: ECE ≤ 0.10**;超過代表模型對自己信心的 self-awareness 不足。

### 4.4 Plan Quality — Judge Rubric

Judge 是 `claude --print --model sonnet-4-5`,收到 issue + plan_draft(**不給 GOLD 或 resolution_summary,避免洩漏**),輸出四維 1-5 分:

| Dimension | 5-分 anchor | 1-分 anchor |
|-----------|-------------|-------------|
| **Relevance** | 每個 step 都直接指向 issue 中描述的 symptom / root cause | 泛泛而談,跟 issue 內容脫節 |
| **Actionability** | Step 是 concrete action(命令、檔案、PR 描述),IC 可照抄 | 抽象建議 ("review the code") |
| **Correctness** | 技術上正確,沒有基於錯誤前提的 step | 有明顯錯誤假設或誤診 |
| **Coverage** | 涵蓋 investigate + fix + verify,沒漏重要 step | 只寫一半(只有調查無修復、或只有修復無驗證) |

**Aggregate: `plan_judge_avg = mean across 4 dims, across all fixtures`**。Gate target: ≥ 3.5 / 5 on TEST。

Judge prompt 用 **rubric-based structured output**(`{"relevance": 4, "actionability": 3, ...}`);**禁止 free-text scoring** —— 自由文本 judge 會有 verbosity bias (plan 越長給越高分)。

### 4.5 Cross-repo Recall

僅對 `|G_i| ≥ 2` 的 fixture 計算:

```
cross_repo_recall = mean_i |R_i[0..3] ∩ G_i| / |G_i|
```

這是跨 group issue (e.g. Fanti 跨 5 layer) 的 critical metric。低表示模型會漏掉某些 repo。

---

## 5. Bias Mitigations

### 5.1 Judge 模型選擇 — version decorrelation

- **Pipeline LLM**: Sonnet 4.6 (Phase 1 + Phase 2,見 `README.md` §1)
- **Ground-truth signal C**: Sonnet 4.6 (comment reader)
- **Judge**: **Sonnet 4.5** via `claude --print --model sonnet-4-5`

刻意讓 judge 比 pipeline **落後一個 minor version**,確保:

1. Judge 不會 self-prefer(同一版模型會偏好自己產的 output — 2024 多篇 paper 證實)
2. Judge 的系統 prompt 傾向與被評者 decorrelated(4.5 和 4.6 訓練資料交集大但 RLHF 路徑不同)

如果未來 pipeline 升到 Sonnet 5.0,judge 跟著動到 4.7,維持「落後一個 minor」的慣例。

### 5.2 Rubric-based vs free-text

已選 rubric(§4.4)。Free-text scoring 的已知 bias:

- **Verbosity bias**: 長 plan > 短 plan (文本越多 judge 越傾向給高分)
- **Self-preference**: 語言風格像 judge 自己的 → 高分
- **Lexical bias**: plan 裡有「verify」「test」「rollback」等正向字詞 → 高分(即使 plan 實際 shit)

Rubric 把評分 anchor 到具體觀察點,大幅壓縮上面三種 bias 的空間。

### 5.3 Judge blind to ground truth

**Judge prompt 只含**:`issue.title`, `issue.description`, `issue.labels`, `phase2.plan_draft`.

**Judge prompt 不含**:`gold.routing_repos`, `gold.assignees`, `gold.resolution_summary`, `provenance.*`, 任何歷史 closing comment。

這樣 judge 只能基於 "plan 本身是否合理"、而非 "plan 有沒有命中真實答案" 評分,避免把 plan quality 和 routing 正確性混在一起 (兩個應該是正交的 metric)。

### 5.4 Verbosity / positional / self-preference 三板斧

| Bias | 機制 | 緩解 |
|------|------|------|
| Verbosity | 長文本 > 短文本 | Rubric-anchored scoring;另報告 `plan_length_tokens` 作 covariate,用於診斷但不計入 gate |
| Positional (pairwise eval 才有) | 先出現的選項 > 後出現 | 我們用 absolute rubric 非 pairwise,結構上免疫 |
| Self-preference | judge 偏好自己風格 | version decorrelation (§5.1) + rubric anchors |

### 5.5 Extractor 獨立性

**極重要**:Phase I 的 signal C (ground truth extractor) 用 Sonnet 4.6,**judge 用 Sonnet 4.5**。若兩者同版,會出現「extractor 和 judge 都對同一種錯誤模式免疫或敏感」的共振——ground truth 的錯誤會被 judge 系統性遺漏。錯開版本把這個 correlated error channel 切斷。

---

## 6. Pitfalls & Acceptance Criteria

### 6.1 Ground truth noise

已知雜訊類型:

- **Duplicate issues**: closed as "duplicate of #NNN" → 真實 routing 是 #NNN 的 routing,不是自己的。Extractor 規則:若 issue 結尾有 `closed as duplicate` → 追 parent issue 再跑 signal A–C。
- **Won't-fix / invalid**: 沒有 resolution,不產生 routing 信號。Extractor 規則:`state_event = 'close'` 但無 MR、無 assignee、comment 包含 "won't fix" / "not a bug" → 標 `rejected.reason = wontfix`,排除。
- **Config-only fixes**: resolution 是改 config(`config/label-routing.yaml` 或其他),無 MR。Signal A 失效,靠 signal B+C 投票,仍可進 GOLD 若 2/3 agree。

Rejected rate 預估 10-15%;>30% 代表 extractor 有問題需要先修。

### 6.2 Overfitting detection

核心機制:TRAIN / TEST split by close date。

- **Overfit 訊號**: TRAIN R@3 升但 TEST R@3 持平或跌 → prompt 把 train-set 特定字眼硬 memorize
- **Healthy iteration**: TRAIN 和 TEST 齊漲(delta 差 < 5pp)
- **Red flag**: TRAIN - TEST R@3 > 10pp → 即便 TEST 過門檻,也要暫停 ship、人工 review 最後一版 prompt

此外,prompt 中 **不得** 包含 train fixture 的 verbatim 內容(iteration log 會記錄 prompt diff,reviewer 檢查)。

### 6.3 Small-label statistical power

| Label | Closed issues in [2026-01-01, today] (est.) | GOLD size feasible | 95% CI width for R@3 |
|-------|---------------------------------------------|--------------------|---------------------|
| K5 | ~300 | 100 | ±9pp |
| BD | ~120 | 60-80 | ±11pp |
| DV | ~80 | 40-60 | ±13pp |
| Fanti | ~150 | 80 | ±11pp |
| Data | ~60 | 30-50 | ±15pp |
| 信義 | ~40 | 20-40 | ±18pp |

**Caveat**:信義 / Data 的 CI 寬達 ±15-18pp,單次 iteration 的 ±3pp 變動無統計顯著性。這些 label 的優化要基於 **judge score + qualitative spot check**,不能只看 R@3 數字跳動。Gate 仍套用(R@3 ≥ 70% AND judge ≥ 3.5),但解讀 R@3 時註記 CI 寬度。

### 6.4 When to ship vs keep iterating

**Ship conditions (all must hold on TEST set)**:

1. `routing_r_at_3 ≥ 0.70`
2. `plan_judge_avg ≥ 3.5` (across 4 dimensions)
3. `confidence_ece ≤ 0.10`
4. 無「單一 fixture 以 judge 1/5 出現多次」情況 (consistent low-quality failure pattern)
5. Iteration log review 通過:沒有 leak test-set 信號、沒有 reward hacking

**Keep iterating conditions (any)**:

- TEST R@3 < 70% 但 TRAIN R@3 ≥ 75% → 先看 overfitting 再決定
- Judge avg 3.3-3.5 但某一維 < 3.0 → 針對該維度 iterate (通常是 Coverage 或 Actionability)
- ECE > 0.15 → confidence calibration 問題,改 confidence prompt signal 而非 routing prompt

**Abort conditions**:

- 超過 10 iteration 仍未達 gate → 回到 Phase I,檢查是否 ground truth 有系統性偏誤
- Judge avg 每次 iteration 都 < 3.0 → prompt template 本身 fundamentally broken,需要重新 design 而非 tune

---

## 7. Cost Model

### 7.1 Per-iteration API cost (K5, n=70 train)

| Stage | Calls | Model | Unit cost | Subtotal |
|-------|-------|-------|-----------|----------|
| Phase 1 routing | 70 | Sonnet 4.6 | ~$0.02 | $1.40 |
| Phase 2 plan draft | ~50 (conf ≥ 0.5 only) | Sonnet 4.6 | ~$0.03 | $1.50 |
| Judge (4 dims × 70) | 70 | Sonnet 4.5 (CLI) | ~$0.015 | $1.05 |
| Overhead / retries | — | — | — | $0.50 |
| **Per-iteration total** | | | | **~$4.45** |

### 7.2 Per-label full loop (up to 10 iterations + final test)

- Train iterations: 10 × $4.45 = $44.50
- Final TEST eval (n=30): $2 (Phase 1+2+judge, one-shot)
- Phase I extraction (n=100, signal C only — A/B 無 LLM 費用): 100 × $0.02 = $2.00
- Per-label total: **~$48.50**

### 7.3 K5 + 5 other labels

- K5 (reference): $48.50
- BD / DV / Fanti / Data / 信義: 5 × ~$45 (assume 略少 iteration, smaller fixture counts): $225
- Cross-label transfer verification runs: $50 (spot re-eval on K5 TEST after template changes from other labels)
- Judge CLI calls overhead (extra for per-dim separation): $30
- **Grand total budget**: **~$350 — $500** (comfortably inside $1000-1500 ceiling stated in plan)

Buffer 預留給:extractor debugging rerun、fixture re-sample (若 first sample 有偏)、human review escalation (若 Open Question #1 觸發)。

---

## 8. Risk Register (9 pitfalls)

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| **R1** | Ground truth 本身錯 (extractor bug 或 bad majority vote) | Medium | High | Tiered ensemble with 3 independent signals, provenance tracking, spot-check 10% manually before each iteration loop |
| **R2** | Test-set leakage via prompt iteration | Medium | Critical | TEST set 封存 during Phase III, iteration log diff review, no fixture text allowed in prompt |
| **R3** | Judge self-preference / verbosity bias | High | Medium | sonnet-4-5 ≠ pipeline sonnet-4-6, rubric-anchored, blind to ground truth, report plan length as covariate |
| **R4** | Small-label CI too wide to measure improvement | High (for 信義/Data) | Medium | Report CI on every metric, combine R@3 with judge score, qualitative spot check mandatory for small labels |
| **R5** | Over-fitting to train set | Medium | High | 70/30 split, early stop after 2 no-improvement iters, hard iteration budget of 10 |
| **R6** | K5 prompt doesn't transfer to Fanti/Data (label-specific idiom) | Medium | Medium | Phase IV runs full Phase I–III per label; variance across labels triggers per-label branching decision |
| **R7** | Cost blow-up from repeated re-eval | Low | Low | Per-iteration budget ~$4.50, anomaly alert if single iteration > $10, $1500 hard ceiling |
| **R8** | Config-only or won't-fix issues pollute GOLD | Medium | Medium | Explicit rejection rules in extractor (§6.1), rejected.json tracked, rejected rate > 30% triggers extractor review |
| **R9** | Judge model deprecation mid-project (sonnet-4-5 retired) | Low | Medium | Fallback: `sonnet-4-6` judge + harder rubric; re-run gate on K5 to establish new-judge baseline before switching |

---

## 9. Open Questions

### Q1 — Human review trigger criteria

Current decision: 0% human review (fully automated via tiered ensemble). Open question: **when is the LLM extractor not enough?**

Candidate triggers (需要後續 session 決定):

- `rejected_rate > 40%` → suspend automation, human triage the rejected pool
- New label family where no signal A can run (issue 從不 link MR) → human bootstrap
- Audit finding: majority-vote answer contradicts engineering lead's recall on > 20% of spot-checked sample

### Q2 — Prompt variant strategy (per-label vs unified)

目前假設 unified prompt template(K5 prompt → 套到其他 label)。若 Phase IV variance 顯示某些 label R@3 持續卡 < 60%,需要 decide:

- **Per-label prompt** — 單獨 maintain 6 套 prompt, higher ceiling,maintenance cost 高
- **Unified prompt with label-conditional sections** — 一個 prompt 裡用 `{% if label == "Fanti" %}` 等 meta,中間地帶

此 decision 依賴 Phase IV 實際數據,不在本 doc 內 lock-down。

### Q3 — Regression detection in production (post-launch)

Eval v2 目前只涵蓋 ship 前的 offline evaluation。**上線後如何偵測 drift?**

Candidate:

- Weekly cron re-eval on rolling 30-day closed-issue window,diff 上週 metrics,R@3 跌 > 5pp → alert
- Production Phase 1/2 output 的 confidence histogram 作 canary — 分布漂移代表 issue 風格變,需要 re-train
- `OPERATIONS.md` §2 (wrong repo suggestion) 的 manual debug flow 不變,但加入 eval suite rerun 作 root-cause tool

三者需要後續 session 明確挑選。

---

## 10. Relationship to Existing B4 Eval

**Eval v2 extends, does not replace, B4.**

| Aspect | B4 (`test/eval/fixtures/*.json`) | Eval v2 (`test/eval/gold/<label>/*.json`) |
|--------|-----------------------------------|-------------------------------------------|
| Purpose | PR-level regression gate (cheap, < 30s) | Closed-loop prompt optimization + ship gate |
| Fixture count | 14 hand-written | 100 per label, auto-extracted |
| Ground truth source | Author judgment | Tiered ensemble (3 signals, ≥2/3 agree) |
| Metrics | Boolean pass/fail per assertion | Multi-metric (R@3, ECE, judge 4-dim, ...) |
| Run frequency | Every PR (CI), every prompt change (pre-commit) | Before each prompt-version release |
| Cost | $0.50 / full run | $4.50 / iteration, $50 / label full loop |
| Consumers | `issue-routing-eval.yml` workflow, local dev | Prompt-tuning session, ship gate review |
| Pass bar | 90% fixture pass | R@3 ≥ 70% AND judge ≥ 3.5 on held-out TEST |

**Co-existence rules**:

1. Synthetic fixtures 留在 `test/eval/fixtures/`,B4 runner (`run-eval.mjs`) 不動。
2. V2 gold fixtures 到 `test/eval/gold/<label>/`,v2 runner (`run-eval-v2.mjs`) 獨立。
3. 兩個 runner 共享 `test/eval/lib/`(schema linter、比較邏輯、judge wrapper),減少重複。
4. CI 上 **B4 在 PR 每次跑、v2 不跑**(cost 太高)。V2 只在 manual `bun run issue-routing:eval-v2 --label K5` 或 prompt release PR 時跑。
5. `bun run issue-routing:eval`(既有)= B4。`bun run issue-routing:eval-v2`(新)= v2。

**Boundary**:B4 fixture 絕對不可混入 v2 gold(synthetic 內容會污染 v2 metrics),反過來也不行(真實 issue 內容有 anonymization 責任超過 B4 的需求)。兩個目錄的 schema 雖類似但不相容,linter 會對各自驗。

---

## Appendix A — File Layout After Eval v2 Ships

```
test/eval/
├── README.md                         # B4 doc (untouched)
├── baseline-v0.json                  # B4 baseline (untouched)
├── run-eval.mjs                      # B4 runner (untouched)
├── run-eval-v2.mjs                   # v2 runner (new)
├── judge-cli.mjs                     # claude --print wrapper (new)
├── metrics.mjs                       # metric functions (new, pure)
├── extract-gold.mjs                  # Phase I extractor (new)
├── fixtures/                         # B4 synthetic (untouched)
│   ├── k5-agent-001-chat-reply-broken.json
│   └── ... 13 more
├── gold/                             # v2 auto-extracted (new)
│   ├── K5/
│   │   ├── K5-0001.json
│   │   └── ... ≤99 more
│   ├── BD/
│   ├── DV/
│   ├── Fanti/
│   ├── Data/
│   └── 信義/
├── rejected/                         # extractor outputs, unresolved (new)
│   └── <label>/<issue-iid>.json
└── runs/                             # per-iteration results (new)
    ├── 20260421-1430-K5-iter03/
    │   ├── metrics.json
    │   └── raw/
    │       └── K5-0042.json
    └── K5-iterations.json            # append-only log
```

## Appendix B — Commands (reference, not implementation)

```bash
# Phase I — extract GOLD for K5
bun run issue-routing:extract-gold -- --label K5 --since 2026-01-01 --n 100

# Phase II + III — iterate prompt with auto-metric
bun run issue-routing:eval-v2 -- --label K5 --split train --iter auto

# Final TEST gate (after iteration done)
bun run issue-routing:eval-v2 -- --label K5 --split test --gate

# Phase IV — transfer to next label
bun run issue-routing:extract-gold -- --label BD --since 2026-01-01 --n 80
bun run issue-routing:eval-v2 -- --label BD --split train --iter auto
```

(這些 command 是 design reference;實際 CLI 設計留給後續 implementation plan。)
