#!/usr/bin/env node
// Backfill `status` field for all entries in raw_data.json
// Determines status from existing data:
//   total > 0  → "reported"
//   total === 0 → "zero"
//   total === null + in leave → "leave"
//   total === null + not in leave → "unreported"
// Note: cannot distinguish "replied_no_hours" from "unreported" without original Chat messages.
//       Future sync runs will set the correct status at parse time.

const fs = require('fs');
const path = require('path');

const dataPath = path.resolve(__dirname, '../public/raw_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const { rawData, leave = {} } = data;

function isOnLeave(member, date, leaveMap) {
  const ranges = leaveMap[member];
  if (!ranges || ranges.length === 0) return false;
  const [dm, dd] = date.split('/').map(Number);
  const dVal = dm * 100 + dd;
  return ranges.some(r => {
    const [sm, sd] = r.start.split('/').map(Number);
    const [em, ed] = r.end.split('/').map(Number);
    return dVal >= sm * 100 + sd && dVal <= em * 100 + ed;
  });
}

const stats = { reported: 0, zero: 0, leave: 0, unreported: 0 };

for (const [date, members] of Object.entries(rawData)) {
  for (const [member, entry] of Object.entries(members)) {
    if (entry.total != null) {
      entry.status = entry.total === 0 ? 'zero' : 'reported';
    } else if (isOnLeave(member, date, leave)) {
      entry.status = 'leave';
    } else {
      entry.status = 'unreported';
    }
    stats[entry.status]++;
  }
}

// Write back
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');

console.log('Backfill complete:');
console.log(`  reported:   ${stats.reported}`);
console.log(`  zero:       ${stats.zero}`);
console.log(`  leave:      ${stats.leave}`);
console.log(`  unreported: ${stats.unreported}`);
console.log(`  total:      ${Object.values(stats).reduce((a, b) => a + b, 0)}`);
