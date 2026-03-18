#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { buildAnalysis, buildDashboardJSON, buildPostPayload } = require('./fetch-gitlab-commits');

const ROOT = path.resolve(__dirname, '..');

/**
 * Dedup commit items by sha+project within each date/member, recalculate count and projects.
 */
function dedupCommitItems(data) {
  for (const [date, members] of Object.entries(data.commits)) {
    for (const [member, info] of Object.entries(members)) {
      const seen = new Set();
      const uniqueItems = [];
      for (const item of info.items) {
        const key = `${item.sha}|${item.project}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueItems.push(item);
      }
      info.items = uniqueItems;
      info.count = uniqueItems.length;
      info.projects = [...new Set(uniqueItems.map(i => i.project))];
    }
  }
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  let commitsPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commits' && args[i + 1]) { commitsPath = args[i + 1]; i++; }
  }
  if (!commitsPath) { console.error('Usage: node analyze-consistency.js --commits <path>'); process.exit(1); }

  const allCommits = JSON.parse(fs.readFileSync(commitsPath, 'utf8'));

  // Load raw_data.json
  const rawDataPath = path.join(ROOT, 'public', 'raw_data.json');
  const existing = fs.existsSync(rawDataPath)
    ? JSON.parse(fs.readFileSync(rawDataPath, 'utf8'))
    : { rawData: {} };
  const dailyUpdateMembers = Object.keys(
    existing.rawData[Object.keys(existing.rawData).pop()] || {}
  );

  // Build analysis
  const analysisResult = buildAnalysis(allCommits, existing.rawData, dailyUpdateMembers);
  const dashboardData = buildDashboardJSON(allCommits, analysisResult.analysis, analysisResult.projectRisks);

  // Merge with existing gitlab-commits.json
  const gitlabJsonPath = path.join(ROOT, 'public', 'gitlab-commits.json');
  if (fs.existsSync(gitlabJsonPath)) {
    const existingGitlab = JSON.parse(fs.readFileSync(gitlabJsonPath, 'utf8'));
    for (const [date, data] of Object.entries(dashboardData.commits)) { existingGitlab.commits[date] = data; }
    for (const [date, data] of Object.entries(dashboardData.analysis)) { existingGitlab.analysis[date] = data; }
    existingGitlab.projectRisks = dashboardData.projectRisks;
    dedupCommitItems(existingGitlab);
    fs.writeFileSync(gitlabJsonPath, JSON.stringify(existingGitlab, null, 2));
  } else {
    dedupCommitItems(dashboardData);
    fs.writeFileSync(gitlabJsonPath, JSON.stringify(dashboardData, null, 2));
  }
  console.error('Wrote gitlab-commits.json (merged)');

  // Print per-date summary to stderr
  for (const [date, members] of Object.entries(analysisResult.analysis)) {
    const counts = { '✅': 0, '⚠️': 0, '🔴': 0 };
    for (const m of Object.values(members)) { counts[m.status] = (counts[m.status] || 0) + 1; }
    console.error(`  ${date}: ✅ ${counts['✅']}  ⚠️ ${counts['⚠️']}  🔴 ${counts['🔴']}`);
  }

  // Output POST payload
  const postPayload = buildPostPayload(allCommits, analysisResult);
  console.log(JSON.stringify(postPayload, null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}

module.exports = { dedupCommitItems };
