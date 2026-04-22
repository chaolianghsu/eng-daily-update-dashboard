#!/usr/bin/env bash
# run-issue-routing.sh — cron entrypoint for issue routing pipeline.
#
# Usage (cron, every 15 min):
#   */15 * * * * cd /path/to/eng-daily-update-dashboard && ./scripts/run-issue-routing.sh >> /var/log/issue-routing.log 2>&1
#
# Env vars:
#   PROJECTS             Comma-separated project paths (default: techcenter/reportcenter,techcenter/reportcenter_confidential)
#   LABEL_CONFIG         Path to label-routing.yaml (default: ./config/label-routing.yaml)
#   GITLAB_CONFIG        Path to gitlab-config.json (default: ./gitlab-config.json)
#   CHAT_CONFIG          Path to chat-config.json (default: ./chat-config.json)
#   STATE_DB             Path to SQLite file (default: ./db/issue-routing.sqlite)
#   ALLOW_CONFIDENTIAL_LLM   "true" | "false" (default: true — per T1 confirmed DPA)
#   ANTHROPIC_API_KEY    Required. Sonnet 4.6 LLM key.
#
# Stages:
#   1. collect-new-issues.mjs   → fetches open issues, diffs against state, queues new/changed
#   2. analyze-and-post.mjs     → runs LLM Phase 1 + 2, posts to Chat, updates state
#
# Independent cron for audit: monthly `scripts/audit-routing-config.mjs` (not run by this script).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

START=$(date +%s)
echo "[run-issue-routing] $(date -u +%Y-%m-%dT%H:%M:%SZ) start"

# Stage 1
echo "[run-issue-routing] stage 1: collect-new-issues"
if ! node scripts/collect-new-issues.mjs; then
  rc=$?
  echo "[run-issue-routing] stage 1 failed with exit $rc"
  exit "$rc"
fi

# Stage 2
echo "[run-issue-routing] stage 2: analyze-and-post"
if ! node scripts/analyze-and-post.mjs; then
  rc=$?
  echo "[run-issue-routing] stage 2 failed with exit $rc"
  exit "$rc"
fi

END=$(date +%s)
echo "[run-issue-routing] $(date -u +%Y-%m-%dT%H:%M:%SZ) done ($(( END - START ))s)"
