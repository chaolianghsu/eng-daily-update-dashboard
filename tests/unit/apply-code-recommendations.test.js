/* eslint-disable */
import { describe, it, expect } from 'vitest';
import {
  applyRecommendations,
  filterRecommendations,
  buildApplySummary,
} from '../../scripts/apply-code-recommendations.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRawData() {
  // Deep-clone-safe builder.
  return {
    rawData: {
      '5/12': {
        Joyce: {
          total: 8,
          meeting: 1,
          dev: 7,
          status: 'reported',
          items: [
            { code: null, task: '處理 KEYPO 後台', hours: 3 },
            { code: 'KEYPO', task: 'Agent API 授權功能', hours: 1 },
            { code: null, task: '工程部讀書會', hours: 1 },
          ],
        },
        Wendy: {
          total: 7,
          meeting: 0,
          dev: 7,
          status: 'reported',
          items: [
            { code: null, task: '新廣告通知信沒發', hours: 4 },
          ],
        },
      },
      '5/13': {
        Joyce: {
          total: 8,
          meeting: 0,
          dev: 8,
          status: 'reported',
          items: [
            { code: null, task: '佳龍 SQL 備份', hours: 1 },
          ],
        },
        // Member with no items
        Empty: {
          total: 0,
          meeting: 0,
          dev: 0,
          status: 'no_report',
        },
      },
    },
  };
}

function makeRecs() {
  return [
    {
      date: '5/12',
      department: '工程',
      member: 'Joyce',
      itemIndex: 0,
      task: '處理 KEYPO 後台',
      currentCode: null,
      recommendedCode: 'KEYPO',
      source: 'rule',
      confidence: 'high',
    },
    {
      date: '5/12',
      department: '工程',
      member: 'Joyce',
      itemIndex: 1, // already coded → must NOT be overwritten
      task: 'Agent API 授權功能',
      currentCode: 'KEYPO',
      recommendedCode: 'MEETING',
      source: 'rule',
      confidence: 'high',
    },
    {
      date: '5/12',
      department: '工程',
      member: 'Joyce',
      itemIndex: 2,
      task: '工程部讀書會',
      currentCode: null,
      recommendedCode: 'MEETING',
      source: 'meeting',
      confidence: 'medium',
    },
    {
      date: '5/12',
      department: '工程',
      member: 'Wendy',
      itemIndex: 0,
      task: '新廣告通知信沒發',
      currentCode: null,
      recommendedCode: 'KEYPO',
      source: 'commit',
      confidence: 'medium',
    },
  ];
}

// ---------------------------------------------------------------------------
// filterRecommendations
// ---------------------------------------------------------------------------

describe('filterRecommendations', () => {
  it('keeps everything with all/all', () => {
    const recs = makeRecs();
    const out = filterRecommendations(recs, { confidence: 'all', source: 'all' });
    expect(out).toHaveLength(4);
  });

  it('filters by confidence=high', () => {
    const recs = makeRecs();
    const out = filterRecommendations(recs, { confidence: 'high', source: 'all' });
    expect(out.every(r => r.confidence === 'high')).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('filters by source=rule', () => {
    const recs = makeRecs();
    const out = filterRecommendations(recs, { confidence: 'all', source: 'rule' });
    expect(out.every(r => r.source === 'rule')).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('combines confidence + source filters', () => {
    const recs = makeRecs();
    const out = filterRecommendations(recs, { confidence: 'medium', source: 'commit' });
    expect(out).toHaveLength(1);
    expect(out[0].member).toBe('Wendy');
  });

  it('drops null-recommendation entries (source=none) regardless of filter', () => {
    const recs = [
      ...makeRecs(),
      {
        date: '5/13',
        department: '工程',
        member: 'Joyce',
        itemIndex: 0,
        task: '佳龍 SQL 備份',
        currentCode: null,
        recommendedCode: null,
        source: 'none',
        confidence: 'low',
      },
    ];
    const out = filterRecommendations(recs, { confidence: 'all', source: 'all' });
    expect(out.every(r => r.recommendedCode != null)).toBe(true);
    expect(out).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// applyRecommendations
// ---------------------------------------------------------------------------

describe('applyRecommendations - happy path', () => {
  it('applies code to all matching null items', () => {
    const data = makeRawData();
    const recs = makeRecs();
    const result = applyRecommendations(data, recs);
    expect(result.applied).toBe(3); // 3 nulls; the 1 already-coded is skipped
    expect(data.rawData['5/12'].Joyce.items[0].code).toBe('KEYPO');
    expect(data.rawData['5/12'].Joyce.items[2].code).toBe('MEETING');
    expect(data.rawData['5/12'].Wendy.items[0].code).toBe('KEYPO');
  });

  it('preserves item array order', () => {
    const data = makeRawData();
    const before = data.rawData['5/12'].Joyce.items.map(i => i.task);
    applyRecommendations(data, makeRecs());
    const after = data.rawData['5/12'].Joyce.items.map(i => i.task);
    expect(after).toEqual(before);
  });
});

describe('applyRecommendations - defensive', () => {
  it('does NOT overwrite an item that already has a code', () => {
    const data = makeRawData();
    const recs = makeRecs();
    const result = applyRecommendations(data, recs);
    // item index 1 had code:'KEYPO', rec says MEETING — should stay KEYPO
    expect(data.rawData['5/12'].Joyce.items[1].code).toBe('KEYPO');
    expect(result.skippedExisting).toBe(1);
  });

  it('skips when date is missing in rawData', () => {
    const data = makeRawData();
    const recs = [{
      date: '12/31', department: '工程', member: 'Joyce', itemIndex: 0,
      task: 'x', currentCode: null, recommendedCode: 'KEYPO',
      source: 'rule', confidence: 'high',
    }];
    const result = applyRecommendations(data, recs);
    expect(result.applied).toBe(0);
    expect(result.skippedMissing).toBe(1);
  });

  it('skips when member is missing on that date', () => {
    const data = makeRawData();
    const recs = [{
      date: '5/12', department: '工程', member: 'NoSuchMember', itemIndex: 0,
      task: 'x', currentCode: null, recommendedCode: 'KEYPO',
      source: 'rule', confidence: 'high',
    }];
    const result = applyRecommendations(data, recs);
    expect(result.applied).toBe(0);
    expect(result.skippedMissing).toBe(1);
  });

  it('skips when itemIndex is out of bounds', () => {
    const data = makeRawData();
    const recs = [{
      date: '5/12', department: '工程', member: 'Joyce', itemIndex: 99,
      task: 'x', currentCode: null, recommendedCode: 'KEYPO',
      source: 'rule', confidence: 'high',
    }];
    const result = applyRecommendations(data, recs);
    expect(result.applied).toBe(0);
    expect(result.skippedMissing).toBe(1);
  });

  it('skips when items array is missing on the member', () => {
    const data = makeRawData();
    const recs = [{
      date: '5/13', department: '工程', member: 'Empty', itemIndex: 0,
      task: 'x', currentCode: null, recommendedCode: 'KEYPO',
      source: 'rule', confidence: 'high',
    }];
    const result = applyRecommendations(data, recs);
    expect(result.applied).toBe(0);
    expect(result.skippedMissing).toBe(1);
  });

  it('skips recommendations with null recommendedCode', () => {
    const data = makeRawData();
    const recs = [{
      date: '5/12', department: '工程', member: 'Joyce', itemIndex: 0,
      task: 'x', currentCode: null, recommendedCode: null,
      source: 'none', confidence: 'low',
    }];
    const result = applyRecommendations(data, recs);
    expect(result.applied).toBe(0);
    expect(data.rawData['5/12'].Joyce.items[0].code).toBe(null);
  });
});

describe('applyRecommendations - dry-run', () => {
  it('does NOT mutate input data when dryRun=true', () => {
    const data = makeRawData();
    const before = JSON.parse(JSON.stringify(data));
    const result = applyRecommendations(data, makeRecs(), { dryRun: true });
    expect(data).toEqual(before);
    expect(result.applied).toBe(3); // still reports what would happen
  });

  it('returns a previewData clone in dryRun mode', () => {
    const data = makeRawData();
    const result = applyRecommendations(data, makeRecs(), { dryRun: true });
    expect(result.previewData).toBeDefined();
    expect(result.previewData.rawData['5/12'].Joyce.items[0].code).toBe('KEYPO');
    // original untouched
    expect(data.rawData['5/12'].Joyce.items[0].code).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// buildApplySummary
// ---------------------------------------------------------------------------

describe('buildApplySummary', () => {
  it('counts applied by code', () => {
    const data = makeRawData();
    const recs = makeRecs();
    const result = applyRecommendations(data, recs);
    const summary = buildApplySummary(result.appliedDetails);
    expect(summary.byCode.KEYPO).toBe(2);
    expect(summary.byCode.MEETING).toBe(1);
  });

  it('counts applied by source', () => {
    const data = makeRawData();
    const result = applyRecommendations(data, makeRecs());
    const summary = buildApplySummary(result.appliedDetails);
    expect(summary.bySource.rule).toBe(1);
    expect(summary.bySource.meeting).toBe(1);
    expect(summary.bySource.commit).toBe(1);
  });

  it('reports total applied', () => {
    const data = makeRawData();
    const result = applyRecommendations(data, makeRecs());
    const summary = buildApplySummary(result.appliedDetails);
    expect(summary.totalApplied).toBe(3);
  });
});
