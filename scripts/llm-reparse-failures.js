#!/usr/bin/env node
'use strict';

/**
 * LLM fallback for parse failures.
 * Reads parsed output + original chat messages, finds entries with
 * replied_no_hours status, and builds a Claude prompt to extract hours.
 *
 * Usage: node scripts/llm-reparse-failures.js <parsed.json> <messages.json>
 * Output: Claude prompt to stdout (pipe to `claude --print -m haiku`)
 *
 * If no failures found, exits with code 0 and outputs nothing.
 */

const fs = require('fs');

const parsedPath = process.argv[2];
const messagesPath = process.argv[3];

if (!parsedPath || !messagesPath) {
  console.error('Usage: node llm-reparse-failures.js <parsed.json> <messages.json>');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(parsedPath, 'utf-8'));
const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf-8'));

// Find entries with replied_no_hours
const failures = [];
const dateEntries = parsed.dateEntries || {};
for (const [date, members] of Object.entries(dateEntries)) {
  for (const [member, data] of Object.entries(members.entry || members)) {
    if (data.status === 'replied_no_hours') {
      failures.push({ date, member });
    }
  }
}

if (failures.length === 0) {
  process.exit(0);
}

// Find original message text for each failure
const memberMap = {};
try {
  const chatConfig = JSON.parse(fs.readFileSync('chat-config.json', 'utf-8'));
  for (const [userId, name] of Object.entries(chatConfig.memberMap || {})) {
    memberMap[userId] = name;
  }
} catch {}

const failureTexts = [];
for (const { date, member } of failures) {
  // Search messages for this member's text around this date
  const memberMessages = (messages.messages || []).filter(m => {
    const senderName = memberMap[m.sender?.name] || '';
    return senderName === member && m.text;
  });

  // Find the message most likely to contain this date's report
  const datePattern = new RegExp(`${date.replace('/', '\\/')}\\s*進度`);
  const matched = memberMessages.find(m => datePattern.test(m.text));
  if (matched) {
    failureTexts.push({
      date,
      member,
      text: matched.text.slice(0, 1000), // Cap at 1000 chars
    });
  }
}

if (failureTexts.length === 0) {
  process.exit(0);
}

// Build prompt
const prompt = `You are extracting work hours from daily update messages. The regex parser failed to extract hours from these messages. Extract the hours manually.

For each message below, output a JSON object with:
- date: the work date (M/D format)
- member: the member name
- total: total hours (number)
- meeting: meeting hours (number, 0 if not mentioned)
- dev: development hours (number, total - meeting)

Hours may be embedded in individual work items like "(4H)" or "(branch, 3H)" — sum them up.
If a message truly contains no hour information, set total/meeting/dev to null.

Output ONLY a JSON array, no explanation.

Messages to parse:
${failureTexts.map((f, i) => `
--- Message ${i + 1} ---
Date: ${f.date}
Member: ${f.member}
Text:
${f.text}
`).join('\n')}

Output:`;

process.stdout.write(prompt);
