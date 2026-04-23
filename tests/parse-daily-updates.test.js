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
