import { describe, it, expect } from 'vitest';
import { parseHoursFromText, generateIssues, findThreads, normalizeChatConfig, parseMessagesFile, pickSpace } from '../scripts/parse-daily-updates.js';

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

  // --- Dash-trailing hour notation (技發 dept style) ---

  it("parses ASCII dash + hour: '- 3H'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] task -3H");
    expect(result.status).toBe('reported');
    expect(result.total).toBe(3);
    expect(result.dev).toBe(3);
  });

  it("parses ASCII dash + hour with space variants: '-3H', ' - 3H'", () => {
    const r1 = parseHoursFromText("5/14 進度：\n1. [Done] task A -3H");
    const r2 = parseHoursFromText("5/14 進度：\n1. [Done] task B - 3H");
    expect(r1.total).toBe(3);
    expect(r2.total).toBe(3);
  });

  it("parses em dash + hour: '—4H'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] task —4H");
    expect(result.status).toBe('reported');
    expect(result.total).toBe(4);
  });

  it("parses em dash with space: '— 1.5H'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] task — 1.5H");
    expect(result.total).toBe(1.5);
  });

  it("parses em dash without preceding space: 'task—4H'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [KEYLM][Done] 完成霹靂報告內容調整與優化—4H");
    expect(result.status).toBe('reported');
    expect(result.total).toBe(4);
  });

  it("parses decimal dash hours: '-1.5H'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] task -1.5H");
    expect(result.total).toBe(1.5);
  });

  it("parses dash with Hr suffix variant: '-3Hr'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] task -3Hr");
    expect(result.total).toBe(3);
  });

  it("does NOT false-match dash inside word: 'link-3-foo'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] check link-3-foo for bugs");
    expect(result.status).toBe('replied_no_hours');
  });

  it("does NOT false-match '- 3 個 items' (digit + non-H char)", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] reviewed - 3 個 items today");
    expect(result.status).toBe('replied_no_hours');
  });

  it("prefers paren hours over mid-line dash: 'task with -3 in title (3H)'", () => {
    const result = parseHoursFromText("5/14 進度：\n1. [Done] task with -3 in title (3H)");
    expect(result.total).toBe(3);
  });

  it("handles mixed-style message (parens + dash + work-hour)", () => {
    const text = "5/14 進度：\n1. [Done] task A (3H)\n2. [Done] task B -2H\n3. [Done] task C —1.5H";
    const result = parseHoursFromText(text);
    expect(result.status).toBe('reported');
    expect(result.total).toBe(6.5);
    expect(result.dev).toBe(6.5);
    expect(result.items).toHaveLength(3);
  });

  it("classifies dash-hour MEETING lines as meeting time", () => {
    const text = "5/14 進度：\n1. [MEETING][Done] KEYLM 產品呈現對焦 -1.5H";
    const result = parseHoursFromText(text);
    expect(result.total).toBe(1.5);
    expect(result.meeting).toBe(1.5);
    expect(result.dev).toBe(0);
  });

  it("parses real 技發 5/14 Richard sample (dash style)", () => {
    const text = `5/14 進度：
1. [MEETING][Done] KEYLM 產品呈現對焦 -1.5H
2. [KEYLM][In Progress] 針對目前簡報持續修正用字與說法 -2H
3. [KEYLM][In Progress] 錄製簡報素材 -3H
4. [KEYLM][Done] 將 vLLM proxy 套上 RAGFlow -1.5H

Blockers:
None

5/15 今日工項：
1. [To Do] 練習報告，並繼續調整顯示方式
2. [To Do] 研究 Dflash LLM 加速技術`;
    const result = parseHoursFromText(text);
    expect(result.status).toBe('reported');
    expect(result.total).toBe(8);
    expect(result.meeting).toBe(1.5);
    expect(result.dev).toBe(6.5);
    expect(result.items).toHaveLength(4);
    expect(result.items[0].code).toBe('MEETING');
    expect(result.items[1].code).toBe('KEYLM');
    expect(result.items[2].code).toBe('KEYLM');
    expect(result.items[3].code).toBe('KEYLM');
  });

  it("parses real 技發 5/14 Patty sample (em dash, no space)", () => {
    const text = `5/14 進度：
1. [KEYLM][Done] 完成霹靂報告內容調整與優化—4H
2. [KEYLM][Done] 協同完成 5/18 BDE 投影片製作—4H

Blockers：
None`;
    const result = parseHoursFromText(text);
    expect(result.status).toBe('reported');
    expect(result.total).toBe(8);
    expect(result.meeting).toBe(0);
    expect(result.dev).toBe(8);
    expect(result.items).toHaveLength(2);
  });

  it("regression: existing engineering parens-style still works", () => {
    const text = `5/14 進度：
1. [KEYPO][Done] 處理 API 授權 (4H)
2. [Done] 工程部讀書會 (1H)
3. [Done] kolranking 效能調整 (3H)`;
    const result = parseHoursFromText(text);
    expect(result.status).toBe('reported');
    expect(result.total).toBe(8);
    expect(result.meeting).toBe(1);
    expect(result.dev).toBe(7);
    expect(result.items).toHaveLength(3);
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

describe('normalizeChatConfig', () => {
  it('collapses legacy single-spaceId config into spaces[]', () => {
    const legacy = {
      spaceId: 'spaces/AAQAQhmoRAk',
      memberMap: { 'users/u1': 'Joyce' },
      queryKeyword: 'Daily Update',
    };
    const n = normalizeChatConfig(legacy);
    expect(n.spaces).toHaveLength(1);
    expect(n.spaces[0]).toMatchObject({
      spaceId: 'spaces/AAQAQhmoRAk',
      center: '工程',
      memberMap: { 'users/u1': 'Joyce' },
    });
    expect(n.queryKeyword).toBe('Daily Update');
  });

  it('passes through new multi-space config unchanged', () => {
    const modern = {
      queryKeyword: 'Daily Update',
      spaces: [
        { spaceId: 'spaces/A', center: '工程', memberMap: {} },
        { spaceId: 'spaces/B', center: '產品', memberMap: {} },
      ],
      centers: { 工程: { label: '工程部', members: [] } },
      validCodes: { KEYPO: { label: 'KEYPO 系列' } },
    };
    const n = normalizeChatConfig(modern);
    expect(n.spaces).toHaveLength(2);
    expect(n.centers).toBe(modern.centers);
    expect(n.validCodes).toBe(modern.validCodes);
  });

  it('defaults queryKeyword to "Daily Update" when absent', () => {
    const n = normalizeChatConfig({ spaceId: 'spaces/A', memberMap: {} });
    expect(n.queryKeyword).toBe('Daily Update');
  });

  it('preserves centers/validCodes from legacy shape if author included them', () => {
    const legacyWithMeta = {
      spaceId: 'spaces/A',
      memberMap: {},
      centers: { 工程: { label: '工程部', members: [] } },
    };
    const n = normalizeChatConfig(legacyWithMeta);
    expect(n.centers).toBeDefined();
  });
});

describe('pickSpace', () => {
  const config = {
    spaces: [
      { spaceId: 'spaces/A', center: '工程', memberMap: { 'users/u1': 'Joyce' } },
      { spaceId: 'spaces/B', center: '技發', memberMap: { 'users/u2': 'Richard' } },
    ],
  };

  it('matches by spaceId', () => {
    const space = pickSpace(config, 'spaces/A');
    expect(space.center).toBe('工程');
  });

  it('matches by center name', () => {
    const space = pickSpace(config, '技發');
    expect(space.center).toBe('技發');
    expect(space.spaceId).toBe('spaces/B');
  });

  it('returns null on unknown selector', () => {
    expect(pickSpace(config, 'spaces/UNKNOWN')).toBeNull();
    expect(pickSpace(config, '未知')).toBeNull();
  });

  it('works on legacy config after normalization', () => {
    const legacy = normalizeChatConfig({ spaceId: 'spaces/X', memberMap: {} });
    const space = pickSpace(legacy, 'spaces/X');
    expect(space).not.toBeNull();
    expect(space.center).toBe('工程');
  });
});

describe('parseMessagesFile with --space-id selector', () => {
  const config = {
    queryKeyword: 'Daily Update',
    spaces: [
      {
        spaceId: 'spaces/A',
        center: '工程',
        memberMap: {
          'users/u1': 'Joyce',
          'users/u2': 'Ivy',
        },
      },
      {
        spaceId: 'spaces/B',
        center: '技發',
        memberMap: {
          'users/u3': 'Richard',
          'users/u4': 'Patty',
        },
      },
    ],
    centers: {
      工程: { label: '工程部', members: ['Joyce', 'Ivy'] },
      技發: { label: '技術發展部', members: ['Richard', 'Patty'] },
    },
  };

  it('uses the matched space memberMap (not spaces[0]) when spaceSelector is set', () => {
    // Single thread starter
    const messages = [
      {
        text: '5/14 Daily Update',
        thread: { name: 'threads/t1' },
        name: 'messages/m1',
      },
      // Reply from Richard (技發 user)
      {
        text: '5/14 進度：\n1. [BDE] 開發 (5H)',
        thread: { name: 'threads/t1' },
        name: 'messages/m2',
        sender: { name: 'users/u3' },
      },
      // Reply from Joyce (工程 user) — must NOT be parsed under 技發 selection
      {
        text: '5/14 進度：\n1. [KEYPO] foo (3H)',
        thread: { name: 'threads/t1' },
        name: 'messages/m3',
        sender: { name: 'users/u1' },
      },
    ];
    // Mock the message file via in-memory injection: use a unique fixture path.
    const fs = require('fs');
    const tmpPath = '/tmp/test-parse-messages.json';
    fs.writeFileSync(tmpPath, JSON.stringify({ messages }));

    const result = parseMessagesFile([tmpPath], null, {
      config,
      spaceSelector: '技發',
    });
    // Richard should be present; Joyce must not be (different space)
    const entry = result.dateEntries['5/14']?.entry || {};
    expect(entry.Richard).toBeDefined();
    expect(entry.Richard.total).toBe(5);
    expect(entry.Joyce).toBeUndefined();
  });

  it('scopes reportingMembers to centers[space.center].members', () => {
    const fs = require('fs');
    const tmpPath = '/tmp/test-parse-messages-2.json';
    fs.writeFileSync(tmpPath, JSON.stringify({
      messages: [
        { text: '5/14 Daily Update', thread: { name: 'threads/t1' }, name: 'messages/m1' },
        {
          text: '5/14 進度：\n1. [BDE] 開發 (5H)',
          thread: { name: 'threads/t1' },
          name: 'messages/m2',
          sender: { name: 'users/u3' },
        },
      ],
    }));

    const result = parseMessagesFile([tmpPath], null, {
      config,
      spaceSelector: 'spaces/B',
    });
    const entry = result.dateEntries['5/14']?.entry || {};
    const memberNames = Object.keys(entry);
    // Reporting members for 技發 are Richard and Patty only — must NOT include 工程 members
    expect(memberNames).toContain('Richard');
    expect(memberNames).toContain('Patty');
    expect(memberNames).not.toContain('Joyce');
    expect(memberNames).not.toContain('Ivy');
  });

  it('falls back to space.memberMap when centers metadata missing', () => {
    const noCentersConfig = {
      queryKeyword: 'Daily Update',
      spaces: [
        {
          spaceId: 'spaces/X',
          center: '技發',
          memberMap: { 'users/u3': 'Richard', 'users/u4': 'Patty' },
        },
      ],
    };
    const fs = require('fs');
    const tmpPath = '/tmp/test-parse-messages-3.json';
    fs.writeFileSync(tmpPath, JSON.stringify({
      messages: [
        { text: '5/14 Daily Update', thread: { name: 'threads/t1' }, name: 'messages/m1' },
        {
          text: '5/14 進度：\n1. [BDE] X (3H)',
          thread: { name: 'threads/t1' },
          name: 'messages/m2',
          sender: { name: 'users/u3' },
        },
      ],
    }));
    const result = parseMessagesFile([tmpPath], null, {
      config: noCentersConfig,
      spaceSelector: 'spaces/X',
    });
    const memberNames = Object.keys(result.dateEntries['5/14']?.entry || {});
    expect(memberNames.sort()).toEqual(['Patty', 'Richard']);
  });

  it('throws when spaceSelector does not match any space', () => {
    const fs = require('fs');
    const tmpPath = '/tmp/test-parse-messages-4.json';
    fs.writeFileSync(tmpPath, JSON.stringify({ messages: [] }));
    expect(() =>
      parseMessagesFile([tmpPath], null, { config, spaceSelector: 'spaces/ZZZ' })
    ).toThrow(/no space matches/i);
  });

  it('preserves legacy behavior (defaults to spaces[0]) when spaceSelector omitted', () => {
    const fs = require('fs');
    const tmpPath = '/tmp/test-parse-messages-5.json';
    fs.writeFileSync(tmpPath, JSON.stringify({
      messages: [
        { text: '5/14 Daily Update', thread: { name: 'threads/t1' }, name: 'messages/m1' },
        {
          text: '5/14 進度：\n1. [KEYPO] foo (3H)',
          thread: { name: 'threads/t1' },
          name: 'messages/m2',
          sender: { name: 'users/u1' },
        },
      ],
    }));
    const result = parseMessagesFile([tmpPath], null, { config });
    const entry = result.dateEntries['5/14']?.entry || {};
    // Default to first space → 工程 → Joyce should be parsed
    expect(entry.Joyce).toBeDefined();
    expect(entry.Joyce.total).toBe(3);
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
