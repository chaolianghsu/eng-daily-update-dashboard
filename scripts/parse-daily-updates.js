#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// --- Constants ---

const MEETING_KEYWORDS = /meeting|會議|讀書會|例會|討論|分享會|sync|臨時會/i;
const LEAVE_KEYWORDS = /請假|休假/;
const HOUR_PATTERN = /[（(]\s*(\d+(?:\.\d+)?)\s*(?:[Hh](?:r|our|ours)?|小時)[^)）]*[)）]/;

// --- Parsing Functions ---

function parseHoursFromText(text) {
  const lines = (text || '').split('\n');
  let total = 0, meeting = 0, dev = 0, found = false;

  for (const line of lines) {
    const re = new RegExp(HOUR_PATTERN.source, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      const h = parseFloat(m[1]);
      total += h;
      found = true;
      if (MEETING_KEYWORDS.test(line)) meeting += h;
      else dev += h;
    }
  }

  if (!found) return { total: null, meeting: null, dev: null };
  return {
    total: Math.round(total * 10) / 10,
    meeting: Math.round(meeting * 10) / 10,
    dev: Math.round(dev * 10) / 10,
  };
}

function parseLeaveRange(text) {
  const dates = [...(text || '').matchAll(/(\d{1,2})\/(\d{1,2})/g)];

  if (dates.length >= 2) {
    return {
      start: `${dates[0][1]}/${dates[0][2]}`,
      end: `${dates[dates.length - 1][1]}/${dates[dates.length - 1][2]}`,
    };
  }

  if (dates.length === 1) {
    // Check same-month shorthand: M/D~N
    const shorthand = text.match(
      /(\d{1,2})\/(\d{1,2})\s*(?:\([^)]*\))?\s*[~～]\s*(\d{1,2})/
    );
    if (shorthand) {
      return {
        start: `${shorthand[1]}/${shorthand[2]}`,
        end: `${shorthand[1]}/${shorthand[3]}`,
      };
    }
    return {
      start: `${dates[0][1]}/${dates[0][2]}`,
      end: `${dates[0][1]}/${dates[0][2]}`,
    };
  }

  return null;
}

function dateToNum(d) {
  const parts = d.split('/').map(Number);
  return parts[0] * 100 + parts[1];
}

function isDateInRange(date, start, end) {
  return dateToNum(date) >= dateToNum(start) && dateToNum(date) <= dateToNum(end);
}

function isOnLeave(date, ranges) {
  return (ranges || []).some((r) => isDateInRange(date, r.start, r.end));
}

function getLeaveRangeForDate(date, ranges) {
  return (ranges || []).find((r) => isDateInRange(date, r.start, r.end));
}

// --- Issue Generation ---

function generateIssues(rawData, leaveMap) {
  const dates = Object.keys(rawData).sort((a, b) => dateToNum(a) - dateToNum(b));
  if (dates.length === 0) return [];

  const latestDate = dates[dates.length - 1];
  const latestData = rawData[latestDate];
  const prevDate = dates.length >= 2 ? dates[dates.length - 2] : null;
  const prevData = prevDate ? rawData[prevDate] : null;
  const members = Object.keys(latestData);
  const issues = [];

  for (const member of members) {
    const data = latestData[member];
    const leave = leaveMap[member] || [];

    // P1: On leave (null data + date in leave range)
    if (data.total === null) {
      const activeLeave = getLeaveRangeForDate(latestDate, leave);
      if (activeLeave) {
        const text =
          activeLeave.start === activeLeave.end
            ? `休假 ${activeLeave.start}`
            : `休假 ${activeLeave.start}-${activeLeave.end}`;
        issues.push({ member, severity: '🟠', text });
        continue;
      }
    }

    // P2: Consecutive unreported days (excluding leave)
    if (data.total === null) {
      let count = 0;
      for (let i = dates.length - 1; i >= 0; i--) {
        const md = rawData[dates[i]][member];
        if (!md || md.total !== null) break;
        if (isOnLeave(dates[i], leave)) continue;
        count++;
      }
      if (count >= 2) {
        issues.push({ member, severity: '🔴', text: `連續 ${count} 天未回報` });
        continue;
      }
    }

    // P3: Unreported today
    if (data.total === null) {
      issues.push({ member, severity: '🔴', text: `未回報 ${latestDate}` });
      continue;
    }

    // P4: Overtime > 8.5hr
    if (data.total > 8.5) {
      issues.push({ member, severity: '🟡', text: `超時 ${data.total}hr` });
      continue;
    }

    // P5: Low hours < 5hr
    if (data.total < 5) {
      issues.push({ member, severity: '🟡', text: `工時偏低 ${data.total}hr` });
      continue;
    }

    // P6: High meeting ratio > 50%
    if (data.meeting && data.total && data.meeting / data.total > 0.5) {
      const pct = Math.round((data.meeting / data.total) * 100);
      issues.push({ member, severity: '🟡', text: `會議佔比 ${pct}%` });
      continue;
    }

    // P7: Improved from < 6 to >= 6.5
    if (prevData?.[member]?.total != null) {
      const prev = prevData[member].total;
      if (prev < 6 && data.total >= 6.5) {
        issues.push({ member, severity: '🟢', text: `改善 ${prev}→${data.total}hr` });
        continue;
      }
    }

    // P8: Stable >= 7hr
    if (data.total >= 7) {
      issues.push({ member, severity: '🟢', text: `穩定 ${data.total}hr` });
    }
  }

  return issues;
}

// --- Message Loading & Thread Parsing ---

function loadMessages(filePaths) {
  const all = [];
  for (const fp of filePaths) {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    // Handle tool-results wrapper: [{type: "text", text: "<json>"}]
    if (Array.isArray(raw) && raw[0]?.type === 'text') {
      const inner = JSON.parse(raw[0].text);
      all.push(...(inner.messages || []));
    } else if (raw.messages) {
      all.push(...raw.messages);
    } else if (Array.isArray(raw)) {
      all.push(...raw);
    }
  }
  return all;
}

function parseLeaveMessages(messages, memberMap) {
  const leaveMap = {};
  for (const msg of messages) {
    const text = msg.text || '';
    if (!LEAVE_KEYWORDS.test(text)) continue;
    const name = memberMap[msg.sender?.name];
    if (!name) continue;
    const range = parseLeaveRange(text);
    if (!range) continue;
    if (!leaveMap[name]) leaveMap[name] = [];
    const isDup = leaveMap[name].some(
      (r) => r.start === range.start && r.end === range.end
    );
    if (!isDup) leaveMap[name].push(range);
  }
  return leaveMap;
}

function findThreads(messages, queryKeyword) {
  const threads = {};
  for (const msg of messages) {
    const text = msg.text || '';
    if (!text.includes(queryKeyword)) continue;
    const dm = text.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (dm) {
      const threadDate = `${parseInt(dm[2])}/${parseInt(dm[3])}`;
      threads[threadDate] = {
        threadName: msg.thread?.name,
        starterName: msg.name,
        threadDate,
      };
    }
  }
  return threads;
}

function parseThread(replies, memberMap) {
  const dateCounts = {};
  const members = {};

  for (const reply of replies) {
    const name = memberMap[reply.sender?.name];
    if (!name) continue;
    const text = reply.text || '';

    // Detect content date (majority vote)
    const cdm = text.match(
      /(\d{1,2})\/(\d{1,2})\s*(?:\([^)]*\))?\s*(?:進度|工項)/
    );
    if (cdm) {
      const d = `${parseInt(cdm[1])}/${parseInt(cdm[2])}`;
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    }

    members[name] = parseHoursFromText(text);
  }

  const contentDate =
    Object.entries(dateCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return { contentDate, members };
}

// --- Main ---

function parseMessagesFile(messageFiles, manualLeave) {
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'chat-config.json'), 'utf8')
  );
  const rawDataPath = path.join(ROOT, 'raw_data.json');
  const existing = fs.existsSync(rawDataPath)
    ? JSON.parse(fs.readFileSync(rawDataPath, 'utf8'))
    : { rawData: {}, issues: [] };

  const messages = loadMessages(messageFiles);
  const { memberMap, queryKeyword = 'Daily Update' } = config;

  // Determine reporting members from existing data
  const existingDates = Object.keys(existing.rawData);
  const reportingMembers =
    existingDates.length > 0
      ? Object.keys(
          existing.rawData[existingDates[existingDates.length - 1]]
        )
      : [];

  // Find threads
  const threadMap = findThreads(messages, queryKeyword);

  // Collect replies per thread
  for (const thread of Object.values(threadMap)) {
    thread.replies = messages.filter(
      (m) =>
        m.thread?.name === thread.threadName &&
        m.name !== thread.starterName &&
        /進度|工項/.test(m.text || '')
    );
  }

  // Parse leave: start with raw_data.json leave, then auto-detect from messages
  const leaveMap = {};
  if (existing.leave) {
    for (const [name, ranges] of Object.entries(existing.leave)) {
      leaveMap[name] = ranges.map((r) => ({ ...r }));
    }
  }
  const autoLeave = parseLeaveMessages(messages, memberMap);
  for (const [name, ranges] of Object.entries(autoLeave)) {
    if (!leaveMap[name]) leaveMap[name] = [];
    for (const r of ranges) {
      const isDup = leaveMap[name].some(
        (x) => x.start === r.start && x.end === r.end
      );
      if (!isDup) leaveMap[name].push(r);
    }
  }

  // Merge CLI --leave overrides
  if (manualLeave) {
    for (const [name, ranges] of Object.entries(manualLeave)) {
      if (!leaveMap[name]) leaveMap[name] = [];
      for (const r of ranges) {
        const isDup = leaveMap[name].some(
          (x) => x.start === r.start && x.end === r.end
        );
        if (!isDup) leaveMap[name].push(r);
      }
    }
  }

  // Parse each thread
  const dateEntries = {};
  for (const thread of Object.values(threadMap)) {
    const { contentDate, members } = parseThread(thread.replies, memberMap);
    const dataDate = contentDate || thread.threadDate;

    // Fill unreported members with null
    const fullEntry = {};
    for (const m of reportingMembers) {
      fullEntry[m] = members[m] || { total: null, meeting: null, dev: null };
    }

    dateEntries[dataDate] = {
      threadDate: thread.threadDate,
      contentDate,
      entry: fullEntry,
      alreadyExists: !!existing.rawData[dataDate],
      reportedCount: Object.keys(members).length,
      totalMembers: reportingMembers.length,
    };
  }

  // Generate issues with merged data
  const mergedRawData = { ...existing.rawData };
  for (const [date, info] of Object.entries(dateEntries)) {
    if (!mergedRawData[date]) {
      mergedRawData[date] = info.entry;
    }
  }
  const issues = generateIssues(mergedRawData, leaveMap);

  return { dateEntries, leaveMap, issues };
}

// --- CLI ---

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = [];
  const manualLeave = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--leave' && args[i + 1]) {
      // Format: "Name:M/D-M/D"
      const parts = args[i + 1].split(':');
      const name = parts[0];
      const range = parts[1];
      const [start, end] = range.includes('-')
        ? range.split('-')
        : [range, range];
      if (!manualLeave[name]) manualLeave[name] = [];
      manualLeave[name].push({ start, end });
      i++;
    } else {
      files.push(args[i]);
    }
  }

  if (files.length === 0) {
    console.error(
      'Usage: node scripts/parse-daily-updates.js <messages-file> [--leave "Name:M/D-M/D"]'
    );
    process.exit(1);
  }

  const result = parseMessagesFile(
    files,
    Object.keys(manualLeave).length > 0 ? manualLeave : null
  );
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  parseHoursFromText,
  parseLeaveRange,
  dateToNum,
  isDateInRange,
  isOnLeave,
  generateIssues,
  parseLeaveMessages,
  parseMessagesFile,
};
