import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'analyze-consistency.js');

function writeTmp(name, data) {
  const p = path.join(ROOT, 'test-results', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

describe('analyze-consistency multi-file', () => {
  const gitlabCommits = [
    { member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'shared-repo', title: 'fix bug', sha: '1234abcd', url: 'http://gitlab/1', unmapped: false, source: 'gitlab' },
    { member: 'A', date: '3/19', datetime: '2026-03-19T11:00:00Z', project: 'gitlab-only', title: 'add feat', sha: '5678efgh', url: 'http://gitlab/2', unmapped: false, source: 'gitlab' },
  ];
  const githubCommits = [
    { member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'shared-repo', title: 'fix bug', sha: '1234abcd', url: 'http://github/1', unmapped: false, source: 'github' },
    { member: 'B', date: '3/19', datetime: '2026-03-19T12:00:00Z', project: 'github-only', title: 'new feature', sha: 'abcd1234', url: 'http://github/2', unmapped: false, source: 'github' },
  ];

  it('accepts multiple --commits files', () => {
    const f1 = writeTmp('gl.json', gitlabCommits);
    const f2 = writeTmp('gh.json', githubCommits);
    const result = execSync(`node ${SCRIPT} --commits ${f1} ${f2} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits).toBeDefined();
  });

  it('deduplicates by sha|project across files (keeps first/GitLab)', () => {
    const f1 = writeTmp('gl2.json', gitlabCommits);
    const f2 = writeTmp('gh2.json', githubCommits);
    const result = execSync(`node ${SCRIPT} --commits ${f1} ${f2} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits.length).toBe(3);
    const duped = payload.gitlabCommits.filter(c => c.sha === '1234abcd' && c.project === 'shared-repo');
    expect(duped.length).toBe(1);
    expect(duped[0].source).toBe('gitlab');
  });

  it('same SHA different project keeps both', () => {
    const gl = [{ member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'repo-a', title: 'fix', sha: 'aaaabbbb', url: 'http://gl/1', unmapped: false, source: 'gitlab' }];
    const gh = [{ member: 'A', date: '3/19', datetime: '2026-03-19T10:00:00Z', project: 'repo-b', title: 'fix', sha: 'aaaabbbb', url: 'http://gh/1', unmapped: false, source: 'github' }];
    const f1 = writeTmp('gl3.json', gl);
    const f2 = writeTmp('gh3.json', gh);
    const result = execSync(`node ${SCRIPT} --commits ${f1} ${f2} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits.length).toBe(2);
  });

  it('single file input still works (backward compat)', () => {
    const f1 = writeTmp('gl4.json', gitlabCommits);
    const result = execSync(`node ${SCRIPT} --commits ${f1} 2>/dev/null`, { encoding: 'utf8' });
    const payload = JSON.parse(result);
    expect(payload.gitlabCommits.length).toBe(2);
  });
});
