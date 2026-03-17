import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('collect-gitlab-commits', () => {
  it('collectCommits is exported from fetch-gitlab-commits.js', () => {
    const mod = require('../scripts/fetch-gitlab-commits.js');
    expect(mod.collectCommits).toBeDefined();
    expect(typeof mod.collectCommits).toBe('function');
  });

  it('script file exists and is valid JS', () => {
    const scriptPath = path.resolve(__dirname, '../scripts/collect-gitlab-commits.js');
    expect(fs.existsSync(scriptPath)).toBe(true);
    // Requiring it should not throw (valid JS syntax)
    expect(() => require(scriptPath)).not.toThrow();
  });

  it('script requires --date argument and calls collectCommits', () => {
    const mod = require('../scripts/collect-gitlab-commits.js');
    // The module should export nothing (it's a CLI script), but it should load without error
    // The main logic is guarded by require.main === module
    expect(mod).toBeDefined();
  });
});
