#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// --- Date Utilities ---

function dateToNum(d) {
  const p = d.split('/').map(Number);
  return p[0] * 100 + p[1];
}

function isDateInRange(date, start, end) {
  return dateToNum(date) >= dateToNum(start) && dateToNum(date) <= dateToNum(end);
}

function isOnLeave(date, ranges) {
  return (ranges || []).some(r => isDateInRange(date, r.start, r.end));
}

function parseDateArg(arg) {
  if (arg.includes('-') && arg.split('-').length === 2 && arg.split('-').every(p => /^\d{1,2}\/\d{1,2}$/.test(p))) {
    return { since: arg.split('-')[0], until: arg.split('-')[1] };
  }
  return { since: arg, until: arg };
}

function expandDateRange(since, until, availableDates) {
  const sinceNum = dateToNum(since);
  const untilNum = dateToNum(until);
  return availableDates.filter(d => {
    const n = dateToNum(d);
    return n >= sinceNum && n <= untilNum;
  });
}

// --- Task Parsing ---

const HOUR_PATTERN = /[（(]\s*(\d+(?:\.\d+)?)\s*(?:[Hh](?:r|our|ours)?|小時)?[^)）]*[)）]/;
const MEETING_KEYWORDS = /meeting|會議|週會|讀書會|例會|討論|分享會|sync|臨時會/i;
const NON_DEV_KEYWORDS = /code review|MR 審核|MR審核|審核|review|planning|規劃|文件|文件整理|documentation|文件撰寫/i;

function parseTasksFromText(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const tasks = [];
  let inProgress = true;

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at blocker/pending/backlog/next-day sections
    if (/^(?:Block|Blocker|Pending|Backlog)/i.test(trimmed)) break;
    // Stop at next day's work items (e.g., "3/16 工項：", "3/16 今日工項：")
    if (/^\d{1,2}\/\d{1,2}\s*(?:\([^)]*\))?\s*(?:今日)?(?:工項|進度)/.test(trimmed) && tasks.length > 0) break;

    // Match numbered list items or items with hour annotations
    const hourMatch = trimmed.match(HOUR_PATTERN);
    if (hourMatch) {
      const hours = parseFloat(hourMatch[1]);
      const isMeeting = MEETING_KEYWORDS.test(trimmed);
      const isNonDev = NON_DEV_KEYWORDS.test(trimmed);
      tasks.push({
        text: trimmed,
        hours,
        isMeeting,
        isNonDev,
        isDev: !isMeeting && !isNonDev,
      });
    }
  }

  return tasks;
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  let dateArg = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--date' || args[i] === '--range') && args[i + 1]) {
      dateArg = args[i + 1];
      i++;
    }
  }

  if (!dateArg) {
    console.error('Usage: node scripts/prepare-task-analysis.js --date <M/D> | --range <M/D-M/D>');
    process.exit(1);
  }

  const { since, until } = parseDateArg(dateArg);
  const periodLabel = since === until ? since : `${since}-${until}`;

  // Load data files
  const rawDataPath = path.join(ROOT, 'public', 'raw_data.json');
  const commitsPath = path.join(ROOT, 'public', 'gitlab-commits.json');

  if (!fs.existsSync(rawDataPath)) {
    console.error('Error: raw_data.json not found');
    process.exit(1);
  }
  if (!fs.existsSync(commitsPath)) {
    console.error('Error: gitlab-commits.json not found');
    process.exit(1);
  }

  const rawDataFile = JSON.parse(fs.readFileSync(rawDataPath, 'utf8'));
  const commitsFile = JSON.parse(fs.readFileSync(commitsPath, 'utf8'));

  const { rawData, dailyUpdates, leave } = rawDataFile;
  const { commits } = commitsFile;

  if (!dailyUpdates || !Array.isArray(dailyUpdates)) {
    console.error('Error: raw_data.json does not contain dailyUpdates array');
    process.exit(1);
  }

  // Determine dates to analyze
  const allDates = Object.keys(rawData).sort((a, b) => dateToNum(a) - dateToNum(b));
  const targetDates = expandDateRange(since, until, allDates);

  if (targetDates.length === 0) {
    console.error(`Error: no data found for date range ${periodLabel}`);
    process.exit(1);
  }

  // Filter to dates that have commit data
  const analyzableDates = targetDates.filter(d => commits[d]);
  if (analyzableDates.length === 0) {
    console.error(`Error: no commit data available for date range ${periodLabel}`);
    process.exit(1);
  }

  // Build per-member, per-date analysis blocks
  const memberBlocks = [];
  const teamStats = {};

  for (const date of analyzableDates) {
    const dateRawData = rawData[date] || {};
    const dateCommits = commits[date] || {};
    const dateUpdates = dailyUpdates.filter(u => u.date === date);

    // Compute team averages for this date
    const memberDevHours = [];
    const memberCommitCounts = [];

    for (const [member, data] of Object.entries(dateRawData)) {
      if (data.dev != null && data.dev > 0) memberDevHours.push(data.dev);
      if (dateCommits[member]) memberCommitCounts.push(dateCommits[member].count);
    }

    const avgDevHours = memberDevHours.length > 0
      ? (memberDevHours.reduce((a, b) => a + b, 0) / memberDevHours.length).toFixed(1)
      : '0';
    const avgCommits = memberCommitCounts.length > 0
      ? (memberCommitCounts.reduce((a, b) => a + b, 0) / memberCommitCounts.length).toFixed(1)
      : '0';

    teamStats[date] = { avgDevHours, avgCommits };

    // Build block for each member with daily update data
    const members = Object.keys(dateRawData);
    for (const member of members) {
      const data = dateRawData[member];

      // Skip members on leave
      if (leave && isOnLeave(date, leave[member])) continue;

      // Skip members with no data (null)
      if (data.total === null) continue;

      // Find daily update text for this member
      const update = dateUpdates.find(u => u.member === member);
      const tasks = update ? parseTasksFromText(update.text) : [];

      // Get commit data
      const memberCommits = dateCommits[member];

      // Build the block
      let block = `## Member: ${member} (${date})\n\n`;
      block += `### Reported Tasks (from daily update):\n`;

      if (tasks.length > 0) {
        tasks.forEach((t, i) => {
          const tag = t.isMeeting ? '[Meeting]' : t.isNonDev ? '[Non-Dev]' : '[Dev]';
          block += `${i + 1}. ${tag} ${t.text}\n`;
        });
      } else if (update) {
        block += `(Raw text, no individual hour annotations parsed)\n${update.text.split('\n').slice(0, 15).join('\n')}\n`;
      } else {
        block += `(No daily update text available)\n`;
      }

      block += `Total reported: ${data.total}H (meeting: ${data.meeting || 0}H, dev: ${data.dev || 0}H)\n\n`;

      block += `### GitLab Commits (same day):\n`;
      if (memberCommits && memberCommits.items.length > 0) {
        memberCommits.items.forEach(item => {
          block += `- [${item.project}] ${item.title} (${item.sha})\n`;
        });
        block += `Total: ${memberCommits.count} commits across ${memberCommits.projects.length} projects\n`;
      } else {
        block += `No commits found\n`;
      }

      block += `\n### Team Average (${date}):\n`;
      block += `Avg dev hours: ${avgDevHours}H, Avg commits: ${avgCommits}\n`;

      memberBlocks.push(block);
    }
  }

  // Build the full prompt
  const prompt = `你是工程部管理分析助手。請分析以下每位成員的每日回報任務與 GitLab commit 記錄的合理性。

## 分析規則

### 檢查類型
1. **low_output（產出不足）**: 開發任務報告 ≥3H，但當天 0 筆相關 commits → 嚴重度 🔴
2. **mismatch（領域不符）**: 任務描述的領域與 commit 專案/訊息不符 → 嚴重度 🟠
3. **outlier（偏離均值）**: 成員的工時/commit 比例顯著低於團隊平均（>2倍差距）→ 嚴重度 🟡

### 豁免條件（不觸發警示）
- 標記為 [Meeting] 的時數：會議不需要 commits
- 標記為 [Non-Dev] 的任務：code review、規劃、文件撰寫等不需要 commits
- 休假成員：已跳過
- 無 commit 資料的日期：已跳過
- 開發任務 <3H 且有少量 commits：不觸發 low_output

### 嚴重度定義
- 🔴 Critical: 開發任務 ≥3H 且 0 筆相關 commits
- 🟡 Warning: 開發工時 vs commit 產出顯著低於團隊平均
- 🟠 Caution: 任務描述領域與 commit 專案不符

## 成員資料

${memberBlocks.join('\n---\n\n')}

## 輸出要求

請直接輸出有效的 JSON（不要加 markdown code fence），格式如下：

{
  "analysisDate": "${new Date().toISOString().split('T')[0]}",
  "period": "${periodLabel}",
  "warnings": [
    {
      "date": "M/D",
      "member": "成員名稱",
      "severity": "🔴|🟡|🟠",
      "type": "low_output|mismatch|outlier",
      "task": "任務描述 (時數)",
      "commits": "相關 commit 摘要",
      "reasoning": "繁體中文說明為什麼標記此警示"
    }
  ],
  "summary": {
    "totalMembers": ${new Set(memberBlocks.map(b => b.match(/## Member: (.+?) \(/)?.[1]).filter(Boolean)).size},
    "totalWarnings": 0,
    "byType": { "low_output": 0, "mismatch": 0, "outlier": 0 }
  }
}

注意事項：
- summary.totalWarnings 必須等於 warnings 陣列長度
- summary.byType 的各數值加總必須等於 totalWarnings
- 如果沒有任何警示，warnings 為空陣列 []
- 所有 reasoning 文字必須使用繁體中文
- 只輸出 JSON，不要加任何其他文字或 markdown 格式
`;

  process.stdout.write(prompt);
}

main();
