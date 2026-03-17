#!/usr/bin/env node
'use strict';

const { generateIssues } = require('./parse-daily-updates');

function mergeDailyData(existing, parsed) {
  const rawData = { ...existing.rawData };
  const dailyUpdates = [];
  const newDates = [];
  const backfilled = [];

  for (const [date, info] of Object.entries(parsed.dateEntries || {})) {
    if (!rawData[date]) {
      // New date — add entire entry
      rawData[date] = info.entry;
      newDates.push(date);
    } else {
      // Existing date — backfill null entries with new data
      for (const [member, data] of Object.entries(info.entry)) {
        if (rawData[date][member] && rawData[date][member].total === null && data.total !== null) {
          rawData[date][member] = data;
          backfilled.push({ date, member, total: data.total, meeting: data.meeting, dev: data.dev });
        }
      }
    }
    // Collect raw replies for daily updates sheet (deduplicate by date+member)
    if (info.rawReplies) {
      const seenDailyUpdate = new Set();
      for (const reply of info.rawReplies) {
        const dedupKey = `${date}|${reply.member}`;
        if (seenDailyUpdate.has(dedupKey)) continue;
        seenDailyUpdate.add(dedupKey);
        dailyUpdates.push({
          date,
          member: reply.member,
          createTime: reply.createTime,
          text: reply.text,
          total: info.entry[reply.member]?.total ?? null,
        });
      }
    }
  }

  // Recalculate issues from merged data when there are changes
  const leaveMap = parsed.leaveMap || existing.leave || {};
  const issues = (newDates.length > 0 || backfilled.length > 0)
    ? generateIssues(rawData, leaveMap)
    : (parsed.issues || existing.issues || []);

  return {
    rawData,
    issues,
    leave: leaveMap,
    dailyUpdates,
    newDates,
    backfilled,
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
