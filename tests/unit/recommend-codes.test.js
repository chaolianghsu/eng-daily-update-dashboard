/* eslint-disable */
import { describe, it, expect } from 'vitest';
import {
  recommendForItem,
  recommendAll,
  buildSummary,
  resolveMemberDepartment,
  resolveValidCodes,
} from '../../scripts/recommend-codes.js';

const VALID_CODES_ENG = {
  KEYPO:     { label: 'KEYPO 平台', gitlabProjectPrefixes: ['KEYPO/', 'keypo-'] },
  KEYDERS:   { label: 'KEYDERS 模組', gitlabProjectPrefixes: ['kol-keyders', 'keyders-metrics'] },
  KEYTECTOR: { label: 'KEYTECTOR', gitlabProjectPrefixes: ['keytector'] },
  KEYKYC:    { label: 'KEYKYC', gitlabProjectPrefixes: ['keykyc'] },
  LSR:       { label: 'Line Social Radar', gitlabProjectPrefixes: ['line-social-radar', 'lsr', 'threads'] },
  BDE:       { label: 'BDE', gitlabProjectPrefixes: ['bigdata/', 'CrawlersV2/'] },
  REVIEW:    { label: 'Code Review / MR Review' },
  MEETING:   { label: '會議' },
  OPS:       { label: '維運 / 部署 / 環境' },
  AGENT:     { label: 'Agent 開發', gitlabProjectPrefixes: ['agent', 'claude'] },
};

const VALID_CODES_TECH = {
  KEYLM:   { label: 'KEYLM 大語言模型', gitlabProjectPrefixes: ['keylm', 'ragflow', 'structure-cot'] },
  MEETING: { label: '會議' },
};

describe('recommendForItem - rule (task description token)', () => {
  it('matches a code key directly in task text', () => {
    const r = recommendForItem({
      task: '處理 KEYPO 後台',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('rule');
    expect(r.confidence).toBe('high');
    expect(r.matchedKeyword).toBe('KEYPO');
  });

  it('is case-insensitive on the code key', () => {
    const r = recommendForItem({
      task: '處理 keypo 後台',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('rule');
  });

  it('prefers more specific code (KEYDERS) over substring of another (KEY)', () => {
    const r = recommendForItem({
      task: '[Done] KEYDERS 主檔細節 會議',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYDERS');
  });
});

describe('recommendForItem - meeting auto-detect', () => {
  it('detects 讀書會', () => {
    const r = recommendForItem({
      task: '工程部讀書會',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('MEETING');
    expect(r.source).toBe('meeting');
    expect(r.confidence).toBe('medium');
  });

  it('detects 例會', () => {
    const r = recommendForItem({
      task: 'KEYPO 例會',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    // rule (KEYPO keyword) takes precedence over meeting
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('rule');
  });

  it('detects sync keyword', () => {
    const r = recommendForItem({
      task: 'F2E Sync 會',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('MEETING');
    expect(r.source).toBe('meeting');
  });

  it('does NOT recommend MEETING if validCodes lacks MEETING', () => {
    const r = recommendForItem({
      task: '工程部讀書會',
      currentCode: null,
      commits: [],
      validCodes: { KEYPO: VALID_CODES_ENG.KEYPO },
    });
    expect(r.recommendedCode).toBe(null);
    expect(r.source).toBe('none');
  });
});

describe('recommendForItem - commit-enriched match', () => {
  it('matches commit project against gitlabProjectPrefixes', () => {
    const r = recommendForItem({
      task: 'AI 修站部署',
      currentCode: null,
      commits: [
        { title: 'fix', sha: 'abc', project: 'KEYPO/keypo-engine/keypo-engine-api-v3', url: 'x' },
      ],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('commit');
    expect(r.confidence).toBe('medium');
    expect(r.matchedProject).toBe('KEYPO/keypo-engine/keypo-engine-api-v3');
  });

  it('picks most frequent code when multiple commits match different codes', () => {
    const r = recommendForItem({
      task: '修 bug',
      currentCode: null,
      commits: [
        { title: 'a', sha: '1', project: 'KEYPO/keypo-engine', url: '' },
        { title: 'b', sha: '2', project: 'KEYPO/keypo-engine', url: '' },
        { title: 'c', sha: '3', project: 'kol-keyders/api', url: '' },
      ],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('commit');
  });

  it('case-insensitive on project prefixes', () => {
    const r = recommendForItem({
      task: '日常開發',
      currentCode: null,
      commits: [
        { title: 'a', sha: '1', project: 'KOL-KEYDERS/api', url: '' },
      ],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYDERS');
    expect(r.source).toBe('commit');
  });
});

describe('recommendForItem - precedence and tiebreakers', () => {
  it('task description match (rule) wins over commit-only match', () => {
    const r = recommendForItem({
      task: '處理 KEYDERS 後端',
      currentCode: null,
      commits: [
        { title: 'a', sha: '1', project: 'KEYPO/keypo-engine', url: '' },
      ],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe('KEYDERS');
    expect(r.source).toBe('rule');
  });

  it('returns none if no signals', () => {
    const r = recommendForItem({
      task: '其他',
      currentCode: null,
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    expect(r.recommendedCode).toBe(null);
    expect(r.source).toBe('none');
  });

  it('skips items that already have a code by default', () => {
    const r = recommendForItem({
      task: '處理 KEYPO 後台',
      currentCode: 'KEYPO',
      commits: [],
      validCodes: VALID_CODES_ENG,
    });
    // existing code preserved, no new recommendation issued
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('existing');
  });

  it('with includeAll=true, re-suggests even when code present', () => {
    const r = recommendForItem({
      task: '處理 KEYPO 後台',
      currentCode: 'OPS',
      commits: [],
      validCodes: VALID_CODES_ENG,
      includeAll: true,
    });
    expect(r.recommendedCode).toBe('KEYPO');
    expect(r.source).toBe('rule');
  });
});

describe('recommendAll - end-to-end on fixture data', () => {
  const fixture = {
    rawData: {
      '5/13': {
        Joyce: { total: 8, meeting: 1, dev: 7, status: 'reported', items: [
          { code: null, task: '處理 KEYPO 後台', hours: 4 },
          { code: null, task: '讀書會', hours: 1 },
          { code: 'OPS', task: '搬遷', hours: 3 },
        ] },
        Richard: { total: 8, meeting: 0, dev: 8, status: 'reported', items: [
          { code: null, task: 'keylm 模型訓練', hours: 8 },
        ] },
      },
      '5/12': {
        Joyce: { total: 8, meeting: 0, dev: 8, status: 'reported', items: [
          { code: null, task: '日常 bug 修', hours: 8 },
        ] },
      },
    },
    centers: {
      工程: { label: '工程', members: ['Joyce'], validCodes: VALID_CODES_ENG },
      技發: { label: '技發', members: ['Richard'], validCodes: VALID_CODES_TECH },
    },
    validCodes: { ...VALID_CODES_ENG, ...VALID_CODES_TECH },
  };

  const fixtureCommits = {
    commits: {
      '5/12': {
        Joyce: { count: 1, projects: ['KEYPO/keypo-engine'], items: [
          { title: 'fix', sha: 'a', project: 'KEYPO/keypo-engine', url: '' },
        ] },
      },
    },
    analysis: {},
    projectRisks: [],
  };

  it('produces recommendations only for null items by default', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits });
    const dates = out.recommendations.map(r => r.date + ':' + r.member + ':' + r.task);
    // OPS item is skipped (already coded). Joyce 5/13 has 2 null + 1 coded → 2 recs.
    // Joyce 5/12 has 1 null → 1 rec. Richard 5/13 has 1 null → 1 rec.
    expect(out.recommendations.length).toBe(4);
  });

  it('summary counts add up: totalNullItems = recommended + noRecommendation', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits });
    expect(out.summary.totalNullItems).toBe(
      out.summary.recommended + out.summary.noRecommendation
    );
  });

  it('filters by --department', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, department: '工程' });
    for (const r of out.recommendations) {
      expect(r.department).toBe('工程');
    }
  });

  it('filters by --member', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, member: 'Joyce' });
    for (const r of out.recommendations) {
      expect(r.member).toBe('Joyce');
    }
  });

  it('filters by date range', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, dateRange: '5/12-5/12' });
    for (const r of out.recommendations) {
      expect(r.date).toBe('5/12');
    }
  });

  it('filters by single date', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, dateRange: '5/13' });
    for (const r of out.recommendations) {
      expect(r.date).toBe('5/13');
    }
  });

  it('uses center-scoped validCodes (技發 cannot recommend KEYPO)', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, member: 'Richard' });
    // Richard "keylm 模型訓練" → should match KEYLM via 技發's validCodes
    const rec = out.recommendations.find(r => r.member === 'Richard');
    expect(rec.recommendedCode).toBe('KEYLM');
    expect(rec.department).toBe('技發');
  });

  it('uses commit-enriched recommendation when task lacks code keyword', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits });
    // Joyce 5/12 "日常 bug 修" + KEYPO commits → KEYPO via commit
    const rec = out.recommendations.find(r => r.date === '5/12' && r.member === 'Joyce');
    expect(rec.recommendedCode).toBe('KEYPO');
    expect(rec.source).toBe('commit');
  });

  it('respects --limit', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, limit: 2 });
    expect(out.recommendations.length).toBe(2);
  });

  it('with includeAll re-suggests already-coded items', () => {
    const out = recommendAll({ data: fixture, commits: fixtureCommits, includeAll: true });
    // Now 5 items total instead of 4 (Joyce 5/13 OPS item is also processed)
    expect(out.recommendations.length).toBe(5);
  });

  it('produces deterministic output for same input', () => {
    const a = JSON.stringify(recommendAll({ data: fixture, commits: fixtureCommits }));
    const b = JSON.stringify(recommendAll({ data: fixture, commits: fixtureCommits }));
    expect(a).toBe(b);
  });
});

describe('resolveMemberDepartment', () => {
  it('finds the member in a center', () => {
    const centers = {
      工程: { label: '工程', members: ['Alice'] },
      技發: { label: '技發', members: ['Bob'] },
    };
    expect(resolveMemberDepartment('Alice', centers)).toBe('工程');
    expect(resolveMemberDepartment('Bob', centers)).toBe('技發');
    expect(resolveMemberDepartment('Carol', centers)).toBe(null);
  });
});

describe('resolveValidCodes', () => {
  it('returns center-level validCodes when present', () => {
    const data = {
      centers: { 工程: { validCodes: VALID_CODES_ENG } },
      validCodes: VALID_CODES_TECH,
    };
    expect(resolveValidCodes(data, '工程')).toBe(VALID_CODES_ENG);
  });

  it('falls back to root validCodes if center has none', () => {
    const data = {
      centers: { 工程: {} },
      validCodes: VALID_CODES_TECH,
    };
    expect(resolveValidCodes(data, '工程')).toBe(VALID_CODES_TECH);
  });

  it('returns empty object if no validCodes anywhere', () => {
    expect(resolveValidCodes({}, '工程')).toEqual({});
  });
});

describe('buildSummary', () => {
  it('computes coverage rate', () => {
    const recs = [
      { recommendedCode: 'KEYPO', source: 'rule', department: '工程' },
      { recommendedCode: 'MEETING', source: 'meeting', department: '工程' },
      { recommendedCode: null, source: 'none', department: '工程' },
      { recommendedCode: 'KEYLM', source: 'rule', department: '技發' },
    ];
    const s = buildSummary(recs, 10);
    expect(s.totalItemsScanned).toBe(10);
    expect(s.totalNullItems).toBe(4);
    expect(s.recommended).toBe(3);
    expect(s.noRecommendation).toBe(1);
    expect(s.coverageRate).toBeCloseTo(0.75, 2);
    expect(s.byCode.KEYPO).toBe(1);
    expect(s.byCode.MEETING).toBe(1);
    expect(s.byCode.KEYLM).toBe(1);
    expect(s.byDepartment['工程']).toBe(3);
    expect(s.byDepartment['技發']).toBe(1);
  });
});
