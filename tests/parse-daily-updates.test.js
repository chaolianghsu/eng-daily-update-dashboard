import { describe, it, expect } from 'vitest';
import { parseHoursFromText, generateIssues, findThreads } from '../scripts/parse-daily-updates.js';

describe('parseHoursFromText', () => {
  it("returns status 'reported' when hours found", () => {
    const result = parseHoursFromText("1. KEYPO engine API (2H)\n2. 讀書會 (1H)");
    expect(result.status).toBe('reported');
    expect(result.total).toBe(3);
  });

  it("returns status 'zero' when total is 0", () => {
    const result = parseHoursFromText("1. 無工作項目 (0H)");
    expect(result.status).toBe('zero');
    expect(result.total).toBe(0);
  });

  it("extracts hours when mixed with non-hour text inside parens like (branch, 4H)", () => {
    const result = parseHoursFromText(
      "1. [In Progress] KOL 開發 (branch, 4H)\n2. [In Progress] SEO 優化 (branch, trello, 3H)"
    );
    expect(result.status).toBe('reported');
    expect(result.total).toBe(7);
    expect(result.dev).toBe(7);
  });

  it("returns status 'replied_no_hours' when no hours found", () => {
    const result = parseHoursFromText("今天做了很多事情但沒寫工時");
    expect(result.status).toBe('replied_no_hours');
    expect(result.total).toBeNull();
  });
});

describe('findThreads', () => {
  const msg = (text, threadName = 'threads/t1') => ({
    text,
    thread: { name: threadName },
    name: 'messages/m1',
  });

  it('indexes standard "2026/04/23 Daily Update" header', () => {
    const threads = findThreads([msg('2026/04/23 Daily Update')], 'Daily Update');
    expect(threads['4/23']).toBeDefined();
    expect(threads['4/23'].threadDate).toBe('4/23');
  });

  it('tolerates 3-digit-year typo like "026/04/23 Daily Update"', () => {
    const threads = findThreads([msg('026/04/23 Daily Update')], 'Daily Update');
    expect(threads['4/23']).toBeDefined();
    expect(threads['4/23'].threadDate).toBe('4/23');
  });

  it('tolerates 2-digit-year like "26/04/23 Daily Update"', () => {
    const threads = findThreads([msg('26/04/23 Daily Update')], 'Daily Update');
    expect(threads['4/23']).toBeDefined();
  });

  it('tolerates year-less "4/23 Daily Update" header', () => {
    const threads = findThreads([msg('4/23 Daily Update')], 'Daily Update');
    expect(threads['4/23']).toBeDefined();
    expect(threads['4/23'].threadDate).toBe('4/23');
  });

  it('skips messages that do not include the query keyword', () => {
    const threads = findThreads([msg('2026/04/23 random note')], 'Daily Update');
    expect(Object.keys(threads)).toHaveLength(0);
  });
});

describe('generateIssues', () => {
  it("generateIssues produces 🟠 for replied_no_hours status", () => {
    const rawData = {
      "3/18": {
        "A": { total: 8, meeting: 1, dev: 7, status: 'reported' },
        "B": { total: null, meeting: null, dev: null, status: 'replied_no_hours' },
      },
    };
    const issues = generateIssues(rawData, {});
    const bIssue = issues.find(i => i.member === 'B');
    expect(bIssue.severity).toBe('🟠');
    expect(bIssue.text).toMatch(/有回覆無工時/);
  });
});

describe('parseHoursFromText — items[] with product code', () => {
  it('extracts code from [CODE] tag at line start', () => {
    const result = parseHoursFromText("1. [KEYPO] BDE 權限新增 (3H)\n2. [BDE] AI 聆聽 (0.5H)");
    expect(result.items).toBeDefined();
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ code: 'KEYPO', hours: 3 });
    expect(result.items[1]).toMatchObject({ code: 'BDE', hours: 0.5 });
    expect(result.total).toBe(3.5);
  });

  it('records null code when line has no [CODE] tag (uncategorized)', () => {
    const result = parseHoursFromText("1. 未分類雜事 (0.5H)\n2. [KEYPO] 開發 (2H)");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].code).toBeNull();
    expect(result.items[1].code).toBe('KEYPO');
  });

  it('extracts hyphenated sub-codes like KEYPO-FE', () => {
    const result = parseHoursFromText("1. [KEYPO-FE] 選單配置 (1.5H)");
    expect(result.items[0].code).toBe('KEYPO-FE');
  });

  it('preserves task description without code prefix', () => {
    const result = parseHoursFromText("1. [KEYPO] BDE 權限新增 (3H)");
    expect(result.items[0].task).toContain('BDE 權限新增');
    expect(result.items[0].task).not.toContain('[KEYPO]');
  });

  it('returns empty items array when no hours found', () => {
    const result = parseHoursFromText("今天沒做事");
    expect(result.items).toEqual([]);
  });

  it('keeps meeting/dev hour totals consistent with items sum', () => {
    const result = parseHoursFromText("1. [KEYPO] 開發 (3H)\n2. 週會 (1H)");
    expect(result.total).toBe(4);
    expect(result.meeting).toBe(1);
    expect(result.dev).toBe(3);
    expect(result.items.reduce((s, it) => s + it.hours, 0)).toBe(4);
  });

  it('lowercase [keypo] is NOT treated as a valid code (uncategorized)', () => {
    const result = parseHoursFromText("1. [keypo] 開發 (3H)");
    expect(result.items[0].code).toBeNull();
  });
});

describe('extractProgressSection — multi-day message regression', () => {
  // Wendy 5/8 bug: she posted a single message covering 5/8 + 5/9 + 5/10
  // with bare date headers like "5/9" (no 進度/工項 keyword). Parser summed all hours
  // into 5/8 (23H). Should stop at "5/9" / "5/10" bare headers too.
  it('stops at bare M/D header even without 進度/工項 keyword', () => {
    const { parseHoursFromText: ph } = require('../scripts/parse-daily-updates.js');
    const text = `5/8 進度：
1. [KEYPO] 開發 (5H)
2. meeting 週會 (2H)

5/9
3. 不應該被算進 5/8 (10H)

5/10
4. 也不應該 (6H)`;
    const r = ph(text);
    expect(r.total).toBe(7);
    expect(r.dev).toBe(5);
    expect(r.meeting).toBe(2);
  });
});
