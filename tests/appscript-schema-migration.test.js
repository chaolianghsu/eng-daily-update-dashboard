import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const codeGsPath = resolve(__dirname, '..', 'appscript', 'Code.gs');
const codeGs = readFileSync(codeGsPath, 'utf-8');

// Extract a top-level function declaration as a callable JS function.
function loadFn(name) {
  var idx = codeGs.indexOf('function ' + name + '(');
  if (idx === -1) throw new Error('function ' + name + ' not found in Code.gs');
  var depth = 0;
  var i = idx;
  for (; i < codeGs.length; i++) {
    var ch = codeGs[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  var body = codeGs.slice(idx, i);
  // eslint-disable-next-line no-new-func
  return new Function('return (' + body + ');')();
}

// Build a mock Sheet object that supports the operations migrateSheetSchema_ uses.
function makeMockSheet(rows) {
  var state = { rows: rows.map(function (r) { return r.slice(); }) };
  return {
    _state: state,
    getLastRow: function () { return state.rows.length; },
    getLastColumn: function () {
      return state.rows.length ? state.rows[0].length : 0;
    },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) {
            var row = state.rows[r - 1 + i] || [];
            var slice = [];
            for (var j = 0; j < nc; j++) {
              slice.push(row[c - 1 + j]);
            }
            out.push(slice);
          }
          return out;
        },
        setValues: function (values) {
          for (var i = 0; i < values.length; i++) {
            var targetRow = r - 1 + i;
            while (state.rows.length <= targetRow) state.rows.push([]);
            var row = state.rows[targetRow];
            for (var j = 0; j < values[i].length; j++) {
              row[c - 1 + j] = values[i][j];
            }
            state.rows[targetRow] = row;
          }
        },
      };
    },
    clear: function () { state.rows = []; },
  };
}

describe('Code.gs migrateSheetSchema_', () => {
  const migrateSheetSchema_ = loadFn('migrateSheetSchema_');

  const lookups = {
    memberToDept: { Joyce: '工程', Ivy: '工程', Richard: '技發', Patty: '技發' },
    deptToParent: { 工程: '產品中心', 技發: '產品中心' },
  };

  it('migrates OLD-schema Daily Updates sheet — prepends 2 columns and backfills', () => {
    const sheet = makeMockSheet([
      ['日期', '成員', '時間', '原始內容', '上一個工作日的工時'],
      ['5/13', 'Joyce', '上午 9:30', 'task A', 8],
      ['5/13', 'Richard', '上午 10:00', 'task B', 7],
    ]);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('completed');
    expect(result.migrated).toBe(2);
    expect(sheet._state.rows[0]).toEqual([
      'parentCenter', 'department', '日期', '成員', '時間', '原始內容', '上一個工作日的工時',
    ]);
    expect(sheet._state.rows[1]).toEqual([
      '產品中心', '工程', '5/13', 'Joyce', '上午 9:30', 'task A', 8,
    ]);
    expect(sheet._state.rows[2]).toEqual([
      '產品中心', '技發', '5/13', 'Richard', '上午 10:00', 'task B', 7,
    ]);
  });

  it('skips already-migrated sheets (no-op when header[0] === parentCenter)', () => {
    const before = [
      ['parentCenter', 'department', '日期', '成員', '時間', '原始內容', '上一個工作日的工時'],
      ['產品中心', '工程', '5/13', 'Joyce', '上午 9:30', 'task A', 8],
    ];
    const sheet = makeMockSheet(before);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('already_migrated');
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(before.length);
    // Sheet untouched
    expect(sheet._state.rows[0][0]).toBe('parentCenter');
    expect(sheet._state.rows.length).toBe(before.length);
  });

  it('graceful no-op on empty sheet', () => {
    const sheet = makeMockSheet([]);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('empty');
    expect(result.migrated).toBe(0);
  });

  it('leaves parentCenter/department empty when member not in memberMap', () => {
    const sheet = makeMockSheet([
      ['日期', '成員', '時間', '原始內容', '上一個工作日的工時'],
      ['5/13', 'UnknownPerson', '', '', ''],
    ]);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('completed');
    expect(sheet._state.rows[1][0]).toBe('');
    expect(sheet._state.rows[1][1]).toBe('');
    expect(sheet._state.rows[1][2]).toBe('5/13');
    expect(sheet._state.rows[1][3]).toBe('UnknownPerson');
  });

  it('handles mixed known + unknown members', () => {
    const sheet = makeMockSheet([
      ['日期', '成員', 'X', 'Y', 'Z'],
      ['5/13', 'Joyce', 'a', 'b', 'c'],
      ['5/13', 'Ghost', 'a', 'b', 'c'],
      ['5/14', 'Patty', 'a', 'b', 'c'],
    ]);
    migrateSheetSchema_(sheet, 1, lookups);
    expect(sheet._state.rows[1][0]).toBe('產品中心');
    expect(sheet._state.rows[1][1]).toBe('工程');
    expect(sheet._state.rows[2][0]).toBe('');
    expect(sheet._state.rows[2][1]).toBe('');
    expect(sheet._state.rows[3][0]).toBe('產品中心');
    expect(sheet._state.rows[3][1]).toBe('技發');
  });

  it('header-only sheet gets the 2 new columns in header, no data rows', () => {
    const sheet = makeMockSheet([
      ['日期', '成員', '時間', '原始內容', '上一個工作日的工時'],
    ]);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('completed');
    expect(result.migrated).toBe(0);
    expect(sheet._state.rows.length).toBe(1);
    expect(sheet._state.rows[0]).toEqual([
      'parentCenter', 'department', '日期', '成員', '時間', '原始內容', '上一個工作日的工時',
    ]);
  });

  it('handles Task Analysis sheet (member at OLD col idx 3)', () => {
    const sheet = makeMockSheet([
      ['analysisDate', 'period', 'date', 'member', 'severity', 'type', 'task', 'commits', 'reasoning'],
      ['2026-05-13', '5/13', '5/13', 'Joyce', '🔴', 'low_output', 'task X', 'sha1', 'reason'],
      ['2026-05-13', '5/13', '5/13', 'Richard', '🟡', 'mismatch', 'task Y', 'sha2', 'reason2'],
    ]);
    migrateSheetSchema_(sheet, 3, lookups);
    expect(sheet._state.rows[0][0]).toBe('parentCenter');
    expect(sheet._state.rows[1][0]).toBe('產品中心');
    expect(sheet._state.rows[1][1]).toBe('工程');
    expect(sheet._state.rows[1][5]).toBe('Joyce'); // member shifted from idx 3 to idx 5
    expect(sheet._state.rows[2][1]).toBe('技發');
    expect(sheet._state.rows[2][5]).toBe('Richard');
  });

  it('is idempotent: running twice on a migrated sheet is a no-op', () => {
    const sheet = makeMockSheet([
      ['日期', '成員', '時間', '原始內容', '上一個工作日的工時'],
      ['5/13', 'Joyce', '上午 9:30', 'task A', 8],
    ]);
    const r1 = migrateSheetSchema_(sheet, 1, lookups);
    expect(r1.reason).toBe('completed');
    const rowsAfter1 = sheet._state.rows.map(function (r) { return r.slice(); });
    const r2 = migrateSheetSchema_(sheet, 1, lookups);
    expect(r2.reason).toBe('already_migrated');
    expect(sheet._state.rows).toEqual(rowsAfter1);
  });

  it('handles Commits-style 7-col sheet', () => {
    const sheet = makeMockSheet([
      ['日期', '成員', 'Project', 'Commit Title', 'SHA', 'URL', 'Source'],
      ['5/13', 'Joyce', 'proj-x', 'fix bug', 'abc123', 'https://x', 'gitlab'],
    ]);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('completed');
    expect(sheet._state.rows[0].length).toBe(9);
    expect(sheet._state.rows[1]).toEqual([
      '產品中心', '工程', '5/13', 'Joyce', 'proj-x', 'fix bug', 'abc123', 'https://x', 'gitlab',
    ]);
  });

  it('handles Plan Correlations sheet (8 cols, member at idx 1)', () => {
    const sheet = makeMockSheet([
      ['date', 'member', 'status', 'specCommits', 'dailyUpdateMention', 'matchedTasks', 'unmatchedSpecs', 'reasoning'],
      ['5/13', 'Patty', 'matched', 2, true, 'task1, task2', '', 'looks good'],
    ]);
    const result = migrateSheetSchema_(sheet, 1, lookups);
    expect(result.reason).toBe('completed');
    expect(sheet._state.rows[0].length).toBe(10);
    expect(sheet._state.rows[1][0]).toBe('產品中心');
    expect(sheet._state.rows[1][1]).toBe('技發');
    expect(sheet._state.rows[1][3]).toBe('Patty');
  });
});

describe('Code.gs doPost migrateSchema branch', () => {
  it('handles migrateSchema:true and dispatches to all 6 dedup-append sheets', () => {
    expect(codeGs).toContain('data.migrateSchema === true');
    expect(codeGs).toContain("'Daily Updates'");
    expect(codeGs).toContain("'Commits'");
    expect(codeGs).toContain("'Commit Analysis'");
    expect(codeGs).toContain("'Task Analysis'");
    expect(codeGs).toContain("'Plan Specs'");
    expect(codeGs).toContain("'Plan Correlations'");
  });

  it('migrateSchema branch runs BEFORE the rawData / clearSheets handlers', () => {
    const migrateIdx = codeGs.indexOf('data.migrateSchema === true');
    const clearIdx = codeGs.indexOf('data.clearSheets');
    const rawDataIdx = codeGs.indexOf('if (data.rawData) writeRawData_');
    expect(migrateIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(rawDataIdx).toBeGreaterThan(-1);
    expect(migrateIdx).toBeLessThan(clearIdx);
    expect(migrateIdx).toBeLessThan(rawDataIdx);
  });

  it('migrateSchema branch returns early (does not write rawData)', () => {
    // The branch must return a ContentService response inside its own block,
    // so payload {migrateSchema:true} doesn't fall through to writeRawData_.
    const migrateIdx = codeGs.indexOf('data.migrateSchema === true');
    const block = codeGs.slice(migrateIdx, migrateIdx + 3000);
    expect(block).toMatch(/return ContentService/);
  });

  it('migrateSchema branch errors when lookups are empty', () => {
    const migrateIdx = codeGs.indexOf('data.migrateSchema === true');
    const block = codeGs.slice(migrateIdx, migrateIdx + 3000);
    expect(block).toMatch(/memberToDept/);
    expect(block).toMatch(/error/);
  });

  it('migrateSheetSchema_ helper exists with the expected signature', () => {
    expect(codeGs).toMatch(/function migrateSheetSchema_\(sheet,\s*memberColIdx,\s*lookups\)/);
  });
});

describe('Code.gs migrateSchema sheet member column indices', () => {
  // Verify the doPost dispatch table maps each sheet to the correct OLD-schema member idx.
  it('Daily Updates → memberCol 1', () => {
    expect(codeGs).toMatch(/'Daily Updates'[^}]*memberCol:\s*1/);
  });
  it('Commits → memberCol 1', () => {
    expect(codeGs).toMatch(/name:\s*'Commits'[^}]*memberCol:\s*1/);
  });
  it('Commit Analysis → memberCol 1', () => {
    expect(codeGs).toMatch(/'Commit Analysis'[^}]*memberCol:\s*1/);
  });
  it('Task Analysis → memberCol 3', () => {
    expect(codeGs).toMatch(/'Task Analysis'[^}]*memberCol:\s*3/);
  });
  it('Plan Specs → memberCol 1', () => {
    expect(codeGs).toMatch(/'Plan Specs'[^}]*memberCol:\s*1/);
  });
  it('Plan Correlations → memberCol 1', () => {
    expect(codeGs).toMatch(/'Plan Correlations'[^}]*memberCol:\s*1/);
  });
});
