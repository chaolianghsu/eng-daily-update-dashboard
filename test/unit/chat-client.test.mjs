// Unit tests for lib/chat-client.mjs — Google Chat API wrapper.
// See docs/superpowers/plans/2026-04-22-issue-routing.md Task C2.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createChatClient,
  ChatApiError,
  verifyWebhookSignature,
  buildAnalysisCard,
} from '../../lib/chat-client.mjs';

const ZERO_BACKOFF = [0, 0, 0];

describe('buildAnalysisCard', () => {
  const issue = {
    uid: 'gitlab:techcenter/reportcenter:42',
    iid: 42,
    title: '使用者匯出 CSV 時炸掉',
    labels: ['bug', 'K5'],
  };
  const analysis = {
    summary: '匯出大量資料時 OOM。',
    suggested_repos: ['techcenter/reportcenter', 'techcenter/export-worker'],
    suggested_assignees: ['byron', 'ray'],
    confidence: 0.87,
    plan_draft: ['分析 heap dump', '切 chunk 匯出'],
  };
  const actionToken = 'tok-abc123';

  it('produces a cardsV2 wrapper with cardId derived from issue.uid', () => {
    const card = buildAnalysisCard({ issue, analysis, actionToken });
    expect(card.cardsV2).toHaveLength(1);
    expect(card.cardsV2[0].cardId).toBe(`issue-${issue.uid}`);
  });

  it('header has 🔍 + title and subtitle with labels and #iid', () => {
    const card = buildAnalysisCard({ issue, analysis, actionToken });
    const header = card.cardsV2[0].card.header;
    expect(header.title).toBe(`🔍 ${issue.title}`);
    expect(header.subtitle).toContain('bug');
    expect(header.subtitle).toContain('K5');
    expect(header.subtitle).toContain(`#${issue.iid}`);
  });

  it('includes summary, suggested repos, assignees with confidence %, and plan draft sections', () => {
    const card = buildAnalysisCard({ issue, analysis, actionToken });
    const sections = card.cardsV2[0].card.sections;
    // 3 content (summary, repos, assignees) + plan_draft + buttons = 5
    expect(sections.length).toBe(5);

    const summarySection = sections[0];
    expect(summarySection.header).toBe('摘要');
    expect(summarySection.widgets[0].textParagraph.text).toBe(analysis.summary);

    const reposSection = sections[1];
    expect(reposSection.header).toBe('建議 repos');
    expect(reposSection.widgets[0].textParagraph.text).toContain('• techcenter/reportcenter');
    expect(reposSection.widgets[0].textParagraph.text).toContain('• techcenter/export-worker');

    const assigneesSection = sections[2];
    expect(assigneesSection.header).toBe('建議 assignees · 信心 87%');
    expect(assigneesSection.widgets[0].textParagraph.text).toBe('byron, ray');

    const planSection = sections[3];
    expect(planSection.header).toBe('Plan draft');
    expect(planSection.widgets[0].textParagraph.text).toContain('分析 heap dump');
  });

  it('omits plan draft section when analysis.plan_draft is null', () => {
    const card = buildAnalysisCard({
      issue,
      analysis: { ...analysis, plan_draft: null },
      actionToken,
    });
    const sections = card.cardsV2[0].card.sections;
    // no plan_draft: 3 content + buttons = 4
    expect(sections.length).toBe(4);
    // ensure buttons still last
    const footer = sections[sections.length - 1];
    expect(footer.widgets[0].buttonList).toBeDefined();
    const headers = sections.map((s) => s.header);
    expect(headers).not.toContain('Plan draft');
  });

  it('builds 3 buttons (Approve / Edit / Dismiss) each with token + issue_uid parameters', () => {
    const card = buildAnalysisCard({ issue, analysis, actionToken });
    const sections = card.cardsV2[0].card.sections;
    const footer = sections[sections.length - 1];
    const buttons = footer.widgets[0].buttonList.buttons;
    expect(buttons).toHaveLength(3);

    const [approve, edit, dismiss] = buttons;
    expect(approve.text).toBe('✅ Approve');
    expect(approve.onClick.action.function).toBe('approveIssue');
    expect(edit.text).toBe('✏️ Edit');
    expect(edit.onClick.action.function).toBe('editIssue');
    expect(dismiss.text).toBe('❌ Dismiss');
    expect(dismiss.onClick.action.function).toBe('dismissIssue');

    for (const btn of buttons) {
      const params = btn.onClick.action.parameters;
      expect(params).toEqual(
        expect.arrayContaining([
          { key: 'token', value: actionToken },
          { key: 'issue_uid', value: issue.uid },
        ]),
      );
    }
  });

  it('rounds confidence to percentage correctly (0.5 → 50%)', () => {
    const card = buildAnalysisCard({
      issue,
      analysis: { ...analysis, confidence: 0.5 },
      actionToken,
    });
    const sections = card.cardsV2[0].card.sections;
    expect(sections[2].header).toBe('建議 assignees · 信心 50%');
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret';
  const body = '{"type":"MESSAGE","message":{"text":"hi"}}';

  function sign(timestamp, bodyStr, key = secret) {
    return createHmac('sha256', key).update(`${timestamp}.${bodyStr}`).digest('hex');
  }

  it('returns true for valid signature + fresh timestamp', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, body);
    expect(verifyWebhookSignature({ body, timestamp, signature, secret })).toBe(true);
  });

  it('returns false for wrong signature', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, body, 'wrong-secret');
    expect(verifyWebhookSignature({ body, timestamp, signature, secret })).toBe(false);
  });

  it('returns false when timestamp > 5 min in past', () => {
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const signature = sign(timestamp, body);
    expect(verifyWebhookSignature({ body, timestamp, signature, secret })).toBe(false);
  });

  it('returns false when timestamp > 5 min in future', () => {
    const timestamp = Math.floor(Date.now() / 1000) + 301;
    const signature = sign(timestamp, body);
    expect(verifyWebhookSignature({ body, timestamp, signature, secret })).toBe(false);
  });

  it('returns false when any required arg is missing', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, body);
    expect(verifyWebhookSignature({ body: null, timestamp, signature, secret })).toBe(false);
    expect(verifyWebhookSignature({ body, timestamp: null, signature, secret })).toBe(false);
    expect(verifyWebhookSignature({ body, timestamp, signature: null, secret })).toBe(false);
    expect(verifyWebhookSignature({ body, timestamp, signature, secret: null })).toBe(false);
  });

  it('does not throw on length-mismatch signature (constant-time compare)', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyWebhookSignature({ body, timestamp, signature: 'short', secret }),
    ).not.toThrow();
    expect(verifyWebhookSignature({ body, timestamp, signature: 'short', secret })).toBe(false);
  });
});

describe('createChatClient', () => {
  let mockFetch;
  let client;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = createChatClient({
      accessToken: 'bearer-token',
      fetch: mockFetch,
      backoffMs: ZERO_BACKOFF,
    });
  });

  describe('postCard', () => {
    it('POSTs to /spaces/{spaceId}/messages with Authorization Bearer + cardsV2 body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'spaces/AAA/messages/MMM',
          thread: { name: 'spaces/AAA/threads/TTT' },
        }),
      });
      const cardObj = buildAnalysisCard({
        issue: { uid: 'u1', iid: 1, title: 't', labels: [] },
        analysis: {
          summary: 's',
          suggested_repos: [],
          suggested_assignees: [],
          confidence: 0,
          plan_draft: null,
        },
        actionToken: 'tok',
      });

      const result = await client.postCard('spaces/AAA', cardObj);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://chat.googleapis.com/v1/spaces/AAA/messages');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer bearer-token');
      expect(opts.headers['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(opts.body);
      expect(parsed.cardsV2).toEqual(cardObj.cardsV2);
      expect(result).toEqual({
        name: 'spaces/AAA/messages/MMM',
        thread: { name: 'spaces/AAA/threads/TTT' },
      });
    });

    it('retries on 429 (rate limit) and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ name: 'm', thread: { name: 't' } }),
        });

      const r = await client.postCard('spaces/AAA', { cardsV2: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(r.name).toBe('m');
    });

    it('does NOT retry on 500 for POST — fails fast to avoid double-post', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const err = await client.postCard('spaces/AAA', { cardsV2: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(ChatApiError);
      expect(err.status).toBe(500);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws ChatApiError on 401 immediately', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const err = await client.postCard('spaces/AAA', { cardsV2: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(ChatApiError);
      expect(err.status).toBe(401);
      expect(err.endpoint).toContain('/spaces/AAA/messages');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('replyInThread', () => {
    it('POSTs with messageReplyOption query param and thread.name in body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ name: 'm', thread: { name: 'spaces/AAA/threads/TTT' } }),
      });

      await client.replyInThread('spaces/AAA', 'spaces/AAA/threads/TTT', { cardsV2: [] });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/spaces/AAA/messages');
      expect(url).toContain('messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
      expect(opts.method).toBe('POST');
      const parsed = JSON.parse(opts.body);
      expect(parsed.thread).toEqual({ name: 'spaces/AAA/threads/TTT' });
      expect(parsed.cardsV2).toEqual([]);
    });
  });

  describe('updateCard', () => {
    it('PATCHes /{messageName}?updateMask=cardsV2 with new card body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ name: 'spaces/AAA/messages/MMM' }),
      });

      const newCard = { cardsV2: [{ cardId: 'c', card: { header: { title: 'new' } } }] };
      await client.updateCard('spaces/AAA/messages/MMM', newCard);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://chat.googleapis.com/v1/spaces/AAA/messages/MMM?updateMask=cardsV2',
      );
      expect(opts.method).toBe('PATCH');
      expect(opts.headers.Authorization).toBe('Bearer bearer-token');
      const parsed = JSON.parse(opts.body);
      expect(parsed.cardsV2).toEqual(newCard.cardsV2);
    });

    it('retries PATCH on 503 (idempotent)', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ name: 'm' }),
        });

      const r = await client.updateCard('spaces/AAA/messages/MMM', { cardsV2: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(r.name).toBe('m');
    });
  });
});
