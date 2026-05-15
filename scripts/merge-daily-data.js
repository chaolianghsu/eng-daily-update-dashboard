#!/usr/bin/env node
'use strict';

const { generateIssues } = require('./parse-daily-updates');

function mergeDailyData(existing, parsed, config) {
  const rawData = { ...existing.rawData };
  const dailyUpdates = [];
  const newDates = [];
  const backfilled = [];
  // Members added to a date that already existed in rawData (e.g., 技發 members
  // landing on a date that previously only had 工程 reporters). Tracked separately
  // from `backfilled` (null → value) so callers can distinguish late reports from
  // a new center joining the dataset.
  const addedToExisting = [];

  for (const [date, info] of Object.entries(parsed.dateEntries || {})) {
    const isNewDate = !rawData[date];
    const backfilledMembers = new Set();
    const addedMembers = new Set();

    if (isNewDate) {
      // New date — add entire entry
      rawData[date] = info.entry;
      newDates.push(date);
    } else {
      // Existing date: two cases per parsed member
      //  (a) member ABSENT from rawData[date] but PRESENT in parsed entry → ADD
      //  (b) member present with total === null but parsed has hours → BACKFILL
      // Never overwrite a reported (non-null) entry.
      for (const [member, data] of Object.entries(info.entry)) {
        const current = rawData[date][member];
        if (!current) {
          // ADD missing member from another space
          rawData[date][member] = data;
          addedMembers.add(member);
          addedToExisting.push({
            date,
            member,
            total: data.total,
            meeting: data.meeting,
            dev: data.dev,
          });
        } else if (current.total === null && data.total !== null) {
          rawData[date][member] = data;
          backfilledMembers.add(member);
          backfilled.push({ date, member, total: data.total, meeting: data.meeting, dev: data.dev });
        }
      }
    }
    // Collect raw replies for daily updates sheet (deduplicate by date+member)
    // For existing dates, only include backfilled OR added members to avoid Sheets duplicates
    if (info.rawReplies) {
      const seenDailyUpdate = new Set();
      for (const reply of info.rawReplies) {
        const dedupKey = `${date}|${reply.member}`;
        if (seenDailyUpdate.has(dedupKey)) continue;
        if (
          !isNewDate &&
          !backfilledMembers.has(reply.member) &&
          !addedMembers.has(reply.member)
        ) {
          continue;
        }
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
  const hasChanges = newDates.length > 0 || backfilled.length > 0 || addedToExisting.length > 0;
  const issues = hasChanges
    ? generateIssues(rawData, leaveMap)
    : (parsed.issues || existing.issues || []);

  // Centers/validCodes precedence: explicit config > existing > undefined.
  const centers = config?.centers ?? existing.centers;
  const validCodes = config?.validCodes ?? existing.validCodes;

  return {
    rawData,
    issues,
    leave: leaveMap,
    dailyUpdates,
    newDates,
    backfilled,
    addedToExisting,
    ...(centers ? { centers } : {}),
    ...(validCodes ? { validCodes } : {}),
  };
}

if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node scripts/merge-daily-data.js <existing.json> <parsed.json> [config.json]');
    process.exit(1);
  }

  const existing = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const parsed = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const config = args[2] ? JSON.parse(fs.readFileSync(args[2], 'utf8')) : undefined;
  const result = mergeDailyData(existing, parsed, config);
  console.log(JSON.stringify(result, null, 2));
}

if (typeof module !== 'undefined') {
  module.exports = { mergeDailyData };
}
