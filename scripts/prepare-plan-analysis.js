#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Build a Claude CLI prompt from detected spec commits + daily updates.
 *
 * @param {Array<{date: string, member: string, commit: Object, files: string[]}>} specs
 * @param {Array<{date: string, member: string, text: string}>} dailyUpdates
 * @param {string} dateArg - e.g. "3/24"
 * @returns {string|null} Prompt string, or null if no specs
 */
function buildPrompt(specs, dailyUpdates, dateArg) {
  if (!specs || specs.length === 0) return null;

  const specsByMember = {};
  for (const spec of specs) {
    if (!specsByMember[spec.member]) {
      specsByMember[spec.member] = [];
    }
    specsByMember[spec.member].push(spec);
  }

  const updatesByMember = {};
  for (const update of (dailyUpdates || [])) {
    if (update.date === dateArg) {
      updatesByMember[update.member] = update;
    }
  }

  const memberBlocks = [];
  for (const [member, memberSpecs] of Object.entries(specsByMember)) {
    let block = `## ${member}\n\n`;

    block += `### 規劃/設計 Commits:\n`;
    for (const spec of memberSpecs) {
      const { commit, files } = spec;
      block += `- [${commit.project}] ${commit.title} (${commit.sha}, ${commit.source})\n`;
      if (files.length > 0) {
        block += `  文件: ${files.join(', ')}\n`;
      }
    }

    block += `\n### Daily Update (${dateArg}):\n`;
    const update = updatesByMember[member];
    if (update) {
      block += update.text + '\n';
    } else {
      block += '無 daily update\n';
    }

    memberBlocks.push(block);
  }

  const members = Object.keys(specsByMember);
  const totalSpecs = specs.length;

  const prompt = `你是工程部管理分析助手。請分析以下成員的規劃/設計類 commits 是否與其 daily update 中的工作描述相符。

## 分析日期: ${dateArg}

## 分析規則

對每個規劃/設計類 commit，檢查 daily update 是否有提及相關工作：
1. **matched（吻合）**: daily update 有提到與此 commit 相關的規劃/設計工作
2. **unmatched（未提及）**: daily update 完全沒有提及相關工作
3. **partial（部分吻合）**: daily update 有提及相關領域，但描述不夠具體或僅部分吻合

## 成員資料

${memberBlocks.join('\n---\n\n')}

## 輸出要求

請直接輸出有效的 JSON（不要加 markdown code fence），格式如下：

{
  "analysisDate": "${new Date().toISOString().split('T')[0]}",
  "period": "${dateArg}",
  "planSpecs": [
    {
      "date": "${dateArg}",
      "member": "成員名稱",
      "commit": {
        "title": "commit 標題",
        "sha": "commit SHA",
        "project": "專案名稱",
        "url": "commit URL",
        "source": "gitlab|github"
      },
      "files": ["docs/specs/example.md"]
    }
  ],
  "correlations": [
    {
      "date": "${dateArg}",
      "member": "成員名稱",
      "status": "matched|unmatched|partial",
      "specCommits": 1,
      "dailyUpdateMention": true,
      "matchedTasks": ["相關任務描述"],
      "unmatchedSpecs": ["未提及的 spec commit 標題"],
      "reasoning": "繁體中文分析理由"
    }
  ],
  "summary": {
    "totalSpecCommits": ${totalSpecs},
    "totalCorrelations": 0,
    "membersWithSpecs": ${members.length},
    "matched": 0,
    "unmatched": 0,
    "partial": 0
  }
}

注意事項：
- planSpecs 必須包含所有輸入的 spec commits 原始資料
- correlations 按成員分組，每位成員一筆 correlation 記錄
- summary.totalCorrelations 必須等於 correlations 陣列長度
- summary.matched + summary.unmatched + summary.partial 必須等於 totalCorrelations
- 所有 reasoning 文字必須使用繁體中文
- 只輸出 JSON，不要加任何其他文字或 markdown 格式
`;

  return prompt;
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  let dateArg = null;
  let specsPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      dateArg = args[i + 1];
      i++;
    } else if (args[i] === '--specs' && args[i + 1]) {
      specsPath = args[i + 1];
      i++;
    }
  }

  if (!dateArg || !specsPath) {
    console.error('Usage: node scripts/prepare-plan-analysis.js --date <M/D> --specs <path>');
    process.exit(1);
  }

  if (!fs.existsSync(specsPath)) {
    console.error(`Error: specs file not found: ${specsPath}`);
    process.exit(1);
  }
  const specs = JSON.parse(fs.readFileSync(specsPath, 'utf8'));

  const rawDataPath = path.join(ROOT, 'public', 'raw_data.json');
  let dailyUpdates = [];
  if (fs.existsSync(rawDataPath)) {
    const rawDataFile = JSON.parse(fs.readFileSync(rawDataPath, 'utf8'));
    dailyUpdates = rawDataFile.dailyUpdates || [];
  }

  const prompt = buildPrompt(specs, dailyUpdates, dateArg);

  if (prompt === null) {
    const emptyResult = {
      analysisDate: new Date().toISOString().split('T')[0],
      period: dateArg,
      planSpecs: [],
      correlations: [],
      summary: {
        totalSpecCommits: 0,
        totalCorrelations: 0,
        membersWithSpecs: 0,
        matched: 0,
        unmatched: 0,
        partial: 0,
      },
    };
    process.stdout.write(JSON.stringify(emptyResult, null, 2));
    process.exit(0);
  }

  process.stdout.write(prompt);
}

if (require.main === module) {
  main();
}

module.exports = { buildPrompt };
