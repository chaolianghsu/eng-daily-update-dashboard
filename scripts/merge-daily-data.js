#!/usr/bin/env node
'use strict';

function mergeDailyData(existing, parsed) {
  const rawData = { ...existing.rawData };

  for (const [date, info] of Object.entries(parsed.dateEntries || {})) {
    if (!info.alreadyExists && !rawData[date]) {
      rawData[date] = info.entry;
    }
  }

  return {
    rawData,
    issues: parsed.issues || existing.issues || [],
    leave: parsed.leaveMap || existing.leave || {},
  };
}

if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node scripts/merge-daily-data.js <existing.json> <parsed.json>');
    process.exit(1);
  }

  const existing = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const parsed = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const result = mergeDailyData(existing, parsed);
  console.log(JSON.stringify(result, null, 2));
}

if (typeof module !== 'undefined') {
  module.exports = { mergeDailyData };
}
