import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const codeGsPath = resolve(__dirname, '..', 'appscript', 'Code.gs');
const codeGs = readFileSync(codeGsPath, 'utf-8');

describe('Code.gs planAnalysis handler', () => {
  it('doPost should handle data.planAnalysis', () => {
    expect(codeGs).toContain('if (data.planAnalysis)');
    // After the multi-center upgrade, writePlanAnalysis_ takes lookups as
    // its third argument.
    expect(codeGs).toMatch(/writePlanAnalysis_\(ss, data\.planAnalysis(?:, lookups)?\)/);
    expect(codeGs).toContain('result.planSpecs');
  });

  it('writePlanAnalysis_ function should exist', () => {
    // Signature now takes lookups for parent/department resolution.
    expect(codeGs).toMatch(/function writePlanAnalysis_\(ss, planAnalysis(?:, lookups)?\)/);
  });

  it('writePlanAnalysis_ should write Plan Specs sheet', () => {
    expect(codeGs).toContain("getSheetByName('Plan Specs')");
    expect(codeGs).toContain("insertSheet('Plan Specs')");
  });

  it('writePlanAnalysis_ should write Plan Correlations sheet', () => {
    expect(codeGs).toContain("getSheetByName('Plan Correlations')");
    expect(codeGs).toContain("insertSheet('Plan Correlations')");
  });

  it('DEDUP_KEY_CONFIG should include Plan Specs (date|dept|member|sha)', () => {
    expect(codeGs).toContain("'Plan Specs'");
    // After prepending parentCenter+department, the key columns are
    // date(2) | dept(1) | member(3) | sha(6).
    expect(codeGs).toMatch(/'Plan Specs'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3,\s*6\]/);
  });

  it('DEDUP_KEY_CONFIG should include Plan Correlations (date|dept|member)', () => {
    expect(codeGs).toContain("'Plan Correlations'");
    // date(2) | dept(1) | member(3)
    expect(codeGs).toMatch(/'Plan Correlations'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*2,\s*3\]/);
  });

  it('Plan Specs header row has parentCenter + department prepended', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'date',\s*'member',\s*'project',\s*'commitTitle',\s*'sha',\s*'files'\]/
    );
  });

  it('Plan Correlations header row has parentCenter + department prepended', () => {
    expect(codeGs).toMatch(
      /\['parentCenter',\s*'department',\s*'date',\s*'member',\s*'status',\s*'specCommits',\s*'matchedTasks',\s*'reasoning'\]/
    );
  });
});
