import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const codeGsPath = resolve(__dirname, '..', 'appscript', 'Code.gs');
const codeGs = readFileSync(codeGsPath, 'utf-8');

// Evaluate the buildLookups_ function from Code.gs as a pure JS helper.
// Code.gs is plain ES5-style JS, so we can wrap and eval the function source.
function loadFn(name) {
  // Match a function declaration block: function name(...) { ... }
  // We slice from "function <name>(" until the matching closing brace at
  // top level (using a brace counter).
  var idx = codeGs.indexOf('function ' + name + '(');
  if (idx === -1) throw new Error('function ' + name + ' not found in Code.gs');
  var depth = 0;
  var start = idx;
  var i = idx;
  for (; i < codeGs.length; i++) {
    var ch = codeGs[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
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

describe('Code.gs buildLookups_', () => {
  const buildLookups_ = loadFn('buildLookups_');

  it('extracts member→department from centers', () => {
    const out = buildLookups_({
      centers: {
        工程: { label: '工程部', parent: '產品中心', members: ['Joyce', 'Ivy'] },
        技發: { label: '技術發展部', parent: '產品中心', members: ['Richard'] },
      },
    });
    expect(out.memberToDept.Joyce).toBe('工程');
    expect(out.memberToDept.Ivy).toBe('工程');
    expect(out.memberToDept.Richard).toBe('技發');
  });

  it('extracts department→parent from centers', () => {
    const out = buildLookups_({
      centers: {
        工程: { label: '工程部', parent: '產品中心', members: [] },
        技發: { label: '技術發展部', parent: '產品中心', members: [] },
      },
    });
    expect(out.deptToParent['工程']).toBe('產品中心');
    expect(out.deptToParent['技發']).toBe('產品中心');
  });

  it('extracts deptToLabel and parentToLabel', () => {
    const out = buildLookups_({
      centers: { 工程: { label: '工程部', parent: '產品中心', members: [] } },
      parentCenters: { 產品中心: { label: '產品中心' } },
    });
    expect(out.deptToLabel['工程']).toBe('工程部');
    expect(out.parentToLabel['產品中心']).toBe('產品中心');
  });

  it('returns empty maps when payload lacks centers/parentCenters', () => {
    const out = buildLookups_({});
    expect(out.memberToDept).toEqual({});
    expect(out.deptToParent).toEqual({});
    expect(out.deptToLabel).toEqual({});
    expect(out.parentToLabel).toEqual({});
  });

  it('falls back to dept name when label is missing', () => {
    const out = buildLookups_({
      centers: { 工程: { parent: '產品中心', members: [] } },
    });
    expect(out.deptToLabel['工程']).toBe('工程');
  });
});

describe('Code.gs multi-center column schema', () => {
  it('writeRawData_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'date',\s*'member',\s*'total',\s*'meeting',\s*'dev'\]/
    );
  });

  it('writeIssues_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'member',\s*'severity',\s*'text'\]/
    );
  });

  it('writeLeave_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'member',\s*'start',\s*'end'\]/
    );
  });

  it('writeDailyUpdates_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'日期',\s*'成員',\s*'時間',\s*'原始內容',\s*'上一個工作日的工時'\]/
    );
  });

  it('writeCommits_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'日期',\s*'成員',\s*'Project',\s*'Commit Title',\s*'SHA',\s*'URL',\s*'Source'\]/
    );
  });

  it('writeCommitAnalysis_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'日期',\s*'成員',\s*'Commits數',\s*'Daily Update工時',\s*'狀態',\s*'參與Projects'\]/
    );
  });

  it('writeTaskAnalysis_ prepends parentCenter and department columns', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'analysisDate',\s*'period',\s*'date',\s*'member',\s*'severity',\s*'type',\s*'task',\s*'commits',\s*'reasoning'\]/
    );
  });

  it('Plan Specs header includes parentCenter and department', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'date',\s*'member',\s*'project',\s*'commitTitle',\s*'sha',\s*'files'\]/
    );
  });

  it('Plan Correlations header includes parentCenter and department', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'date',\s*'member',\s*'status',\s*'specCommits',\s*'matchedTasks',\s*'reasoning'\]/
    );
  });
});

describe('Code.gs new reference + items sheets', () => {
  it('writeCenters_ function exists and writes Centers sheet', () => {
    expect(codeGs).toContain('function writeCenters_(');
    expect(codeGs).toContain("getSheetByName('Centers')");
    expect(codeGs).toContain("insertSheet('Centers')");
    expect(codeGs).toMatch(/\['parentCenter',\s*'label',\s*'departments'\]/);
  });

  it('writeDepartments_ function exists and writes Departments sheet', () => {
    expect(codeGs).toContain('function writeDepartments_(');
    expect(codeGs).toContain("getSheetByName('Departments')");
    expect(codeGs).toContain("insertSheet('Departments')");
    expect(codeGs).toMatch(/\['department',\s*'label',\s*'parentCenter',\s*'members'\]/);
  });

  it('writeItems_ function exists and writes Items sheet with right columns', () => {
    expect(codeGs).toContain('function writeItems_(');
    expect(codeGs).toContain("getSheetByName('Items')");
    expect(codeGs).toContain("insertSheet('Items')");
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'date',\s*'member',\s*'code',\s*'hours'\]/
    );
  });

  it('doPost calls buildLookups_ and the new writers', () => {
    expect(codeGs).toContain('buildLookups_(data)');
    expect(codeGs).toMatch(/if\s*\(\s*data\.parentCenters\s*\)\s*writeCenters_/);
    expect(codeGs).toMatch(/if\s*\(\s*data\.centers\s*\)\s*writeDepartments_/);
    expect(codeGs).toMatch(/if\s*\(\s*data\.rawData\s*\)[^;]*writeItems_/);
  });
});

describe('Code.gs dedup key updates', () => {
  it('Daily Updates dedup key includes department', () => {
    // Order: date|dept|member → cols [0, 2, 3] after prepending parent, dept
    expect(codeGs).toMatch(/'Daily Updates'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3\]/);
  });

  it('Commits dedup key includes department', () => {
    // date|dept|member|sha → after prepending parent, dept: cols [0, 2, 3, 6]
    expect(codeGs).toMatch(/'Commits'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3,\s*6\]/);
  });

  it('Commit Analysis dedup key includes department', () => {
    expect(codeGs).toMatch(/'Commit Analysis'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3\]/);
  });

  it('Plan Specs dedup key includes department', () => {
    // date|dept|member|sha → cols [0, 2, 3, 6]
    expect(codeGs).toMatch(/'Plan Specs'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3,\s*6\]/);
  });

  it('Plan Correlations dedup key includes department', () => {
    expect(codeGs).toMatch(/'Plan Correlations'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3\]/);
  });

  it('comments document the dept inclusion in dedup keys', () => {
    expect(codeGs).toMatch(/date\|dept\|member/);
  });
});

describe('Code.gs item flattening logic (writeItems_)', () => {
  it('uses items array on each member', () => {
    expect(codeGs).toMatch(/\.items\b/);
  });

  it('writes empty string when item.code is null', () => {
    // We just verify the function references a null/empty-string fallback for code.
    const idx = codeGs.indexOf('function writeItems_(');
    expect(idx).toBeGreaterThan(-1);
    const block = codeGs.slice(idx, idx + 4000);
    expect(block).toMatch(/code\s*===\s*null|code\s*\|\|\s*''/);
  });
});
