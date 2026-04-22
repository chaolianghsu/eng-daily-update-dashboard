// lib/chat-client.mjs — Google Chat REST API wrapper (post card, threaded reply, update, webhook verify).
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task C2.
//
// Responsibilities:
//   - Typed error (ChatApiError with .status / .endpoint / .retries)
//   - Retry 429 on writes (rate limit, safe after backoff) and 429/5xx on PATCH (idempotent)
//   - Fail fast on 4xx (except 429)
//   - Do NOT retry POST on 5xx (risk of double-post; caller handles higher-level dedup)
//   - Constant-time webhook signature verification with 5-minute replay window
//   - Pure card v2 structure builder (no I/O)
//
// Not responsible for:
//   - OAuth token acquisition / refresh (caller passes access token)
//   - Idempotency beyond HTTP method semantics
//   - Webhook secret storage

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_ROOT = 'https://chat.googleapis.com/v1';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = [1000, 5000, 15000];
const REPLAY_WINDOW_SEC = 300;

export class ChatApiError extends Error {
  constructor(message, { status, endpoint, retries } = {}) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.retries = retries;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createChatClient({
  accessToken,
  fetch = globalThis.fetch,
  maxRetries = DEFAULT_MAX_RETRIES,
  backoffMs = DEFAULT_BACKOFF_MS,
}) {
  if (!accessToken) throw new Error('createChatClient: accessToken is required');
  if (typeof fetch !== 'function') {
    throw new Error('createChatClient: fetch is not available (inject via options on Node < 18)');
  }

  // retryPolicy:
  //   'idempotent' (GET/PATCH) — retry on 429 AND 5xx up to maxRetries
  //   'write'      (POST)      — retry on 429 only; fail fast on 5xx (avoid double-post)
  async function apiCall(endpoint, { method = 'GET', body = null, retryPolicy = 'idempotent' } = {}) {
    const url = `${API_ROOT}${endpoint}`;
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (body != null) headers['Content-Type'] = 'application/json';

    const attempts = maxRetries;
    let lastError;

    for (let i = 0; i < attempts; i++) {
      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body != null ? JSON.stringify(body) : undefined,
        });
      } catch (networkErr) {
        lastError = networkErr;
        // Treat network errors like 5xx: retry only for idempotent ops.
        if (retryPolicy === 'idempotent' && i < attempts - 1) {
          await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0);
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return await response.json();
      }

      const status = response.status;

      // 429 rate limit: retryable for both writes and reads.
      if (status === 429) {
        lastError = new ChatApiError(
          `Chat 429 ${response.statusText || 'Too Many Requests'}`.trim(),
          { status, endpoint, retries: i },
        );
        if (i < attempts - 1) {
          await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0);
          continue;
        }
        throw lastError;
      }

      // Other 4xx: throw immediately.
      if (status >= 400 && status < 500) {
        throw new ChatApiError(
          `Chat ${status} ${response.statusText || ''}`.trim(),
          { status, endpoint, retries: i },
        );
      }

      // 5xx: retry only if idempotent; writes fail fast.
      lastError = new ChatApiError(
        `Chat ${status} ${response.statusText || ''}`.trim(),
        { status, endpoint, retries: i },
      );
      if (retryPolicy === 'idempotent' && i < attempts - 1) {
        await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0);
        continue;
      }
      throw lastError;
    }

    throw lastError;
  }

  return {
    async postCard(spaceId, cardObj) {
      const endpoint = `/${spaceId}/messages`;
      return apiCall(endpoint, {
        method: 'POST',
        body: { cardsV2: cardObj.cardsV2 },
        retryPolicy: 'write',
      });
    },

    async replyInThread(spaceId, threadName, cardObj) {
      const endpoint = `/${spaceId}/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;
      return apiCall(endpoint, {
        method: 'POST',
        body: {
          cardsV2: cardObj.cardsV2,
          thread: { name: threadName },
        },
        retryPolicy: 'write',
      });
    },

    async updateCard(messageName, cardObj) {
      const endpoint = `/${messageName}?updateMask=cardsV2`;
      return apiCall(endpoint, {
        method: 'PATCH',
        body: { cardsV2: cardObj.cardsV2 },
        retryPolicy: 'idempotent',
      });
    },
  };
}

// ---- buildAnalysisCard (pure) ----

export function buildAnalysisCard({ issue, analysis, actionToken }) {
  const subtitleParts = [];
  if (issue.labels && issue.labels.length > 0) {
    subtitleParts.push(issue.labels.join(' · '));
  }
  subtitleParts.push(`#${issue.iid}`);

  const buttonParams = [
    { key: 'token', value: actionToken },
    { key: 'issue_uid', value: issue.uid },
  ];

  const sections = [
    {
      header: '摘要',
      widgets: [{ textParagraph: { text: analysis.summary } }],
    },
    {
      header: '建議 repos',
      widgets: [
        {
          textParagraph: {
            text: (analysis.suggested_repos ?? []).map((r) => `• ${r}`).join('\n'),
          },
        },
      ],
    },
    {
      header: `建議 assignees · 信心 ${Math.round((analysis.confidence ?? 0) * 100)}%`,
      widgets: [
        { textParagraph: { text: (analysis.suggested_assignees ?? []).join(', ') } },
      ],
    },
    analysis.plan_draft
      ? {
          header: 'Plan draft',
          widgets: [
            {
              textParagraph: {
                text: analysis.plan_draft.map((s) => `${s}`).join('\n'),
              },
            },
          ],
        }
      : null,
    {
      widgets: [
        {
          buttonList: {
            buttons: [
              {
                text: '✅ Approve',
                onClick: {
                  action: { function: 'approveIssue', parameters: buttonParams },
                },
              },
              {
                text: '✏️ Edit',
                onClick: {
                  action: { function: 'editIssue', parameters: buttonParams },
                },
              },
              {
                text: '❌ Dismiss',
                onClick: {
                  action: { function: 'dismissIssue', parameters: buttonParams },
                },
              },
            ],
          },
        },
      ],
    },
  ].filter(Boolean);

  return {
    cardsV2: [
      {
        cardId: `issue-${issue.uid}`,
        card: {
          header: {
            title: `🔍 ${issue.title}`,
            subtitle: subtitleParts.join(' · '),
          },
          sections,
        },
      },
    ],
  };
}

// ---- verifyWebhookSignature (pure; constant-time) ----

export function verifyWebhookSignature({ body, timestamp, signature, secret }) {
  // Reject on any missing arg — never throw.
  if (body == null || timestamp == null || signature == null || secret == null) {
    return false;
  }

  // Enforce 5-minute replay window.
  const nowSec = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > REPLAY_WINDOW_SEC) return false;

  let expected;
  try {
    expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  } catch {
    return false;
  }

  // timingSafeEqual requires equal-length buffers.
  const sigBuf = Buffer.from(String(signature), 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;

  try {
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
