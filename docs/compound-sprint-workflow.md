# Compound Sprint 工作流：gstack + Superpowers 整合方案

> 核心原則：**gstack 包 Superpowers** — gstack 負責 implementation 前後的一切（scope、review、QA、ship），Superpowers 負責中間的 implementation loop。

## 四階段概覽

```
Phase 1: Think & Scope    Phase 2: Build           Phase 3: Verify          Phase 4: Ship
(gstack, Architect)       (Superpowers, Agent)     (gstack, QA)             (gstack, Release)
┌─────────────────┐      ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ /office-hours   │      │ /write-plan      │     │ /review          │     │ /ship            │
│ /plan-ceo-review│ ──→  │ /execute-plan    │ ──→ │ /qa              │ ──→ │ /land-and-deploy │
│ /plan-eng-review│      │   TDD inner loop │     │ /cso             │     │ /document-release│
│                 │      │   Red→Green→     │     │ /investigate     │     │ /retro           │
│                 │      │   Refactor→      │     │                  │     │                  │
│                 │      │   /simplify→     │     │                  │     │                  │
│                 │      │   Re-test→Commit │     │                  │     │                  │
└─────────────────┘      └──────────────────┘     └──────────────────┘     └──────────────────┘
     30-60 min              Agent 自主執行            品質關卡                  Release 自動化
```

## Phase 1：Think & Scope（gstack，Architect 主導）

Architect 花 30-60 分鐘定義需求。按順序跑三個 gstack skill：

| 步驟 | Skill | 角色 | 產出 |
|------|-------|------|------|
| 1 | `/office-hours` | YC Office Hours | 把模糊需求變成清晰問題定義（6 個 forcing questions） |
| 2 | `/plan-ceo-review` | CEO/Founder | 檢視 scope 合理性（4 種模式：擴張/選擇性擴張/維持/縮減） |
| 3 | `/plan-eng-review` | Eng Manager | 鎖定架構：ASCII data flow 圖、state machine、error paths、test matrix |

**產出**：design doc + test plan → 取代 Superpowers `/brainstorm` 作為起點。

## Phase 2：Build（Superpowers，Agent 自主執行）

拿 Phase 1 的 design doc 進入 Superpowers 的 inner loop：

1. `/write-plan` — 把 design doc 拆解成 task list（存在檔案裡，不受 token limit 影響）
2. `/execute-plan` — 開 subagent session，每個 task 嚴格執行 TDD cycle：

```
Red → Green → Refactor → /simplify → Re-test → Commit
```

- Superpowers 的 **1% Rule** 確保 agent 不跳步
- 每完成一個 logical chunk，**code-reviewer subagent** 自動 review
- Critical issue 會 block progress

**為什麼 Build 留給 Superpowers**：TDD 紀律比 gstack 嚴格（先寫 code 不寫 test 會被強制刪掉重來），token 消耗極低（核心 <2K tokens），長 session 更有效率。

## Phase 3：Verify & Harden（gstack，品質關卡）

Build 完成後，用 gstack 做品質把關：

| Skill | 角色 | 做什麼 |
|-------|------|--------|
| `/review` | Staff Engineer | 找 production bugs（N+1 queries、race conditions、trust boundary violations），自動修 obvious issues |
| `/qa` | QA Lead | 開真實 browser 測試：點擊、填表、截圖。找到 bug 自動修 + 產生 regression test |
| `/cso` | Chief Security Officer | OWASP Top 10 + STRIDE threat model。每個 finding 附 exploit scenario |
| `/investigate` | Debugger | 如果上面發現難解 bug，做 systematic root cause analysis。自動 freeze 到調查的 module |

## Phase 4：Ship & Reflect（gstack，Release 自動化）

| Skill | 做什麼 |
|-------|--------|
| `/ship` | 跑 test、audit coverage、push、開 PR |
| `/land-and-deploy` | merge PR、等 CI、驗證 production health |
| `/document-release` | 自動更新 README、ARCHITECTURE、CLAUDE.md |
| `/retro` | 每週回顧：per-person breakdowns、shipping streaks、test health trends |

## 導入計畫

### 第一步（立即）

保留現有 Superpowers 工作流不動，只加裝 gstack 的 `/review` + `/qa` 作為 post-build 關卡。

```
現有流程：... → /execute-plan → commit
加裝後：  ... → /execute-plan → commit → /review → /qa
```

### 第二步（兩週後）

把 Phase 1 planning 從 Superpowers `/brainstorm` 切換到 gstack `/office-hours` + `/plan-eng-review`。

### 第三步（一個月後）

加入進階 skills：
- `/cso` — KEYPO 等企業產品的安全審計
- `/retro` — 對接週報流程
- `/ship` + `/land-and-deploy` — Release 自動化

### 不動的部分

Superpowers 的 TDD inner loop（Red-Green-Refactor）是團隊已 roll out 的核心工作流，不替換。

## 技術共存

| | Superpowers | gstack |
|---|---|---|
| 安裝方式 | plugin (`/plugin install`) | skills (`~/.claude/skills/gstack/`) |
| 狀態目錄 | `.claude/` | `~/.gstack/` |
| Slash commands | `/superpowers:*` | `/review`, `/qa`, `/ship` 等 |
| 衝突 | 無 — namespace 不同，狀態獨立 | |

## 安裝步驟

```bash
# 1. Clone 到 Claude Code skills 目錄
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack

# 2. 執行 setup（編譯 browse binary、安裝 Chromium、建立 symlinks）
cd ~/.claude/skills/gstack && ./setup

# 3. 重啟 Claude Code 載入新 skills
```
