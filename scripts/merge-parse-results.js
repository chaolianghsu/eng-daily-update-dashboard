#!/usr/bin/env node
'use strict';

/**
 * Merge LLM re-parsed results into the original parsed output.
 * Overwrites replied_no_hours entries with LLM-extracted hours.
 *
 * Usage: node scripts/merge-parse-results.js <parsed.json> <llm-output.json>
 * Output: updated parsed JSON to stdout
 */

const fs = require('fs');

const parsedPath = process.argv[2];
const llmPath = process.argv[3];

if (!parsedPath || !llmPath) {
  console.error('Usage: node merge-parse-results.js <parsed.json> <llm-output.json>');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(parsedPath, 'utf-8'));
let llmResults;

try {
  const raw = fs.readFileSync(llmPath, 'utf-8').trim();
  // Extract JSON array from LLM output (may have markdown fences)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('Warning: LLM output contains no JSON array, skipping merge');
    process.stdout.write(JSON.stringify(parsed, null, 2));
    process.exit(0);
  }
  llmResults = JSON.parse(jsonMatch[0]);
} catch (e) {
  console.error('Warning: Failed to parse LLM output:', e.message);
  process.stdout.write(JSON.stringify(parsed, null, 2));
  process.exit(0);
}

let merged = 0;
const dateEntries = parsed.dateEntries || {};

for (const result of llmResults) {
  if (!result.date || !result.member || result.total == null) continue;

  const dateEntry = dateEntries[result.date];
  if (!dateEntry) continue;

  const memberEntry = dateEntry.entry?.[result.member] || dateEntry[result.member];
  if (!memberEntry) continue;

  if (memberEntry.status === 'replied_no_hours') {
    memberEntry.total = Math.round(result.total * 10) / 10;
    memberEntry.meeting = Math.round((result.meeting || 0) * 10) / 10;
    memberEntry.dev = Math.round((result.dev || result.total) * 10) / 10;
    memberEntry.status = memberEntry.total === 0 ? 'zero' : 'reported';
    merged++;
    console.error(`Merged: ${result.member} ${result.date} → ${memberEntry.total}h`);
  }
}

console.error(`LLM fallback: ${merged}/${llmResults.length} entries merged`);
process.stdout.write(JSON.stringify(parsed, null, 2));
