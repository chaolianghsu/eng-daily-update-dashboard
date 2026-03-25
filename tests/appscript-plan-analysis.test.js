import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const codeGsPath = resolve(__dirname, '..', 'appscript', 'Code.gs');
const codeGs = readFileSync(codeGsPath, 'utf-8');

describe('Code.gs planAnalysis handler', () => {
  it('doPost should handle data.planAnalysis', () => {
    expect(codeGs).toContain('if (data.planAnalysis)');
    expect(codeGs).toContain('writePlanAnalysis_(ss, data.planAnalysis)');
    expect(codeGs).toContain('result.planSpecs');
  });

  it('writePlanAnalysis_ function should exist', () => {
    expect(codeGs).toContain('function writePlanAnalysis_(ss, planAnalysis)');
  });

  it('writePlanAnalysis_ should write Plan Specs sheet', () => {
    expect(codeGs).toContain("getSheetByName('Plan Specs')");
    expect(codeGs).toContain("insertSheet('Plan Specs')");
  });

  it('writePlanAnalysis_ should write Plan Correlations sheet', () => {
    expect(codeGs).toContain("getSheetByName('Plan Correlations')");
    expect(codeGs).toContain("insertSheet('Plan Correlations')");
  });

  it('DEDUP_KEY_CONFIG should include Plan Specs', () => {
    expect(codeGs).toContain("'Plan Specs'");
    // date|member|sha => cols [0, 1, 4]
    expect(codeGs).toMatch(/'Plan Specs'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*1,\s*4\]/);
  });

  it('DEDUP_KEY_CONFIG should include Plan Correlations', () => {
    expect(codeGs).toContain("'Plan Correlations'");
    // date|member => cols [0, 1]
    expect(codeGs).toMatch(/'Plan Correlations'\s*:\s*\{[^}]*cols\s*:\s*\[0,\s*1\]/);
  });

  it('Plan Specs header row should have correct columns', () => {
    expect(codeGs).toMatch(/\['date',\s*'member',\s*'project',\s*'commitTitle',\s*'sha',\s*'files'\]/);
  });

  it('Plan Correlations header row should have correct columns', () => {
    expect(codeGs).toMatch(/\['date',\s*'member',\s*'status',\s*'specCommits',\s*'matchedTasks',\s*'reasoning'\]/);
  });
});
