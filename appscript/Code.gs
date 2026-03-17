/**
 * Serves the dashboard HTML page.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('工程部 Daily Update Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Receives JSON data from Claude sync skill and writes to Sheets.
 * Expected payload: { rawData: {...}, issues: [...], leave: {...} }
 */
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Clear specified sheets before writing (for rebuild/dedup)
  if (data.clearSheets) {
    var sheetsToClean = Array.isArray(data.clearSheets) ? data.clearSheets : [data.clearSheets];
    for (var i = 0; i < sheetsToClean.length; i++) {
      var sheetToClear = ss.getSheetByName(sheetsToClean[i]);
      if (sheetToClear) sheetToClear.clear();
    }
  }

  if (data.rawData) writeRawData_(ss, data.rawData);
  if (data.issues) writeIssues_(ss, data.issues);
  if (data.leave) writeLeave_(ss, data.leave);
  if (data.dailyUpdates) writeDailyUpdates_(ss, data.dailyUpdates);
  if (data.gitlabCommits) writeGitlabCommits_(ss, data.gitlabCommits);
  if (data.commitAnalysis) writeCommitAnalysis_(ss, data.commitAnalysis);
  if (data.taskAnalysis) writeTaskAnalysis_(ss, data.taskAnalysis);

  var result = { status: 'ok' };
  if (data.rawData) result.dates = Object.keys(data.rawData).length;
  if (data.gitlabCommits) result.commits = data.gitlabCommits.length;
  if (data.taskAnalysis) result.taskWarnings = data.taskAnalysis.warnings ? data.taskAnalysis.warnings.length : 0;
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Returns dashboard data as JSON string (called from client via google.script.run).
 */
function getDashboardData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rawData = readRawData_(ss);
  var issues = readIssues_(ss);
  var leave = readLeave_(ss);
  return JSON.stringify({ rawData: rawData, issues: issues, leave: leave });
}

// --- Write helpers ---

function writeRawData_(ss, rawData) {
  var sheet = ss.getSheetByName('rawData');
  if (!sheet) sheet = ss.insertSheet('rawData');
  sheet.clear();

  var rows = [['date', 'member', 'total', 'meeting', 'dev']];
  var dates = Object.keys(rawData).sort(function(a, b) {
    return dateToNum_(a) - dateToNum_(b);
  });

  for (var i = 0; i < dates.length; i++) {
    var date = dates[i];
    var members = Object.keys(rawData[date]);
    for (var j = 0; j < members.length; j++) {
      var m = members[j];
      var h = rawData[date][m];
      rows.push([date, m, h.total, h.meeting, h.dev]);
    }
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  }
}

function writeIssues_(ss, issues) {
  var sheet = ss.getSheetByName('issues');
  if (!sheet) sheet = ss.insertSheet('issues');
  sheet.clear();

  var rows = [['member', 'severity', 'text']];
  for (var i = 0; i < issues.length; i++) {
    rows.push([issues[i].member, issues[i].severity, issues[i].text]);
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  }
}

function writeLeave_(ss, leave) {
  var sheet = ss.getSheetByName('leave');
  if (!sheet) sheet = ss.insertSheet('leave');
  sheet.clear();

  var rows = [['member', 'start', 'end']];
  var members = Object.keys(leave);
  for (var i = 0; i < members.length; i++) {
    var ranges = leave[members[i]];
    for (var j = 0; j < ranges.length; j++) {
      rows.push([members[i], ranges[j].start, ranges[j].end]);
    }
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  }
}

function writeDailyUpdates_(ss, dailyUpdates) {
  var sheet = ss.getSheetByName('Daily Updates');
  if (!sheet) sheet = ss.insertSheet('Daily Updates');

  // Read existing rows to deduplicate by date+member
  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][0]) + '|' + String(existing[i][1]);
    existingKeys[key] = true;
  }

  // Add header if sheet is empty
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 5).setValues([['日期', '成員', '時間', '原始內容', '上一個工作日的工時']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var i = 0; i < dailyUpdates.length; i++) {
    var u = dailyUpdates[i];
    var key = String(u.date) + '|' + String(u.member);
    if (existingKeys[key]) continue;

    var time = '';
    if (u.createTime) {
      var d = new Date(u.createTime);
      var hours = d.getHours();
      var minutes = d.getMinutes();
      var period = hours < 12 ? '上午' : '下午';
      var displayHour = hours <= 12 ? hours : hours - 12;
      time = period + ' ' + displayHour + ':' + (minutes < 10 ? '0' : '') + minutes;
    }

    newRows.push([u.date, u.member, time, u.text || '', u.total === null ? '' : u.total]);
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 5).setValues(newRows);
  }
}

function writeGitlabCommits_(ss, commits) {
  var sheet = ss.getSheetByName('GitLab Commits');
  if (!sheet) sheet = ss.insertSheet('GitLab Commits');

  // Read existing rows for deduplication by date|member|sha
  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][0]) + '|' + String(existing[i][1]) + '|' + String(existing[i][4]);
    existingKeys[key] = true;
  }

  // Add header if empty
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 6).setValues([['日期', '成員', 'Project', 'Commit Title', 'SHA', 'URL']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var i = 0; i < commits.length; i++) {
    var c = commits[i];
    var key = String(c.date) + '|' + String(c.member) + '|' + String(c.sha);
    if (existingKeys[key]) continue;
    newRows.push([c.date, c.member, c.project, c.title, c.sha, c.url || '']);
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 6).setValues(newRows);
  }
}

function writeCommitAnalysis_(ss, analysis) {
  var sheet = ss.getSheetByName('Commit Analysis');
  if (!sheet) sheet = ss.insertSheet('Commit Analysis');

  // Read existing rows for deduplication by date|member (overwrite mode)
  var existing = sheet.getDataRange().getValues();
  var existingKeyRows = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][0]) + '|' + String(existing[i][1]);
    existingKeyRows[key] = i + 1; // 1-based row number
  }

  // Add header if empty
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 6).setValues([['日期', '成員', 'Commits數', 'Daily Update工時', '狀態', '參與Projects']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var i = 0; i < analysis.length; i++) {
    var a = analysis[i];
    var key = String(a.date) + '|' + String(a.member);
    var row = [a.date, a.member, a.commitCount, a.dailyUpdateHours === null ? '' : a.dailyUpdateHours, a.status, a.projects];
    if (existingKeyRows[key]) {
      // Overwrite existing row
      sheet.getRange(existingKeyRows[key], 1, 1, 6).setValues([row]);
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 6).setValues(newRows);
  }
}

/**
 * Returns commit data as JSON string (called from client via google.script.run).
 * Returns null (as string) if no GitLab Commits sheet exists.
 */
function getCommitData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var commitSheet = ss.getSheetByName('GitLab Commits');
  if (!commitSheet) return JSON.stringify(null);

  // Read commits: group by date → member
  var commitRows = commitSheet.getDataRange().getValues();
  var commits = {};
  for (var i = 1; i < commitRows.length; i++) {
    var date = formatDate_(commitRows[i][0]);
    var member = String(commitRows[i][1]);
    var project = String(commitRows[i][2]);
    var title = String(commitRows[i][3]);
    var sha = String(commitRows[i][4]);
    if (!date || !member) continue;

    if (!commits[date]) commits[date] = {};
    if (!commits[date][member]) commits[date][member] = { count: 0, projects: [], items: [] };
    commits[date][member].count++;
    if (commits[date][member].projects.indexOf(project) === -1) {
      commits[date][member].projects.push(project);
    }
    var url = String(commitRows[i][5] || '');
    commits[date][member].items.push({ title: title, sha: sha, project: project, url: url || null });
  }

  // Read analysis
  var analysisSheet = ss.getSheetByName('Commit Analysis');
  var analysis = {};
  var projectRisks = [];
  if (analysisSheet) {
    var analysisRows = analysisSheet.getDataRange().getValues();
    var projectContributors = {};
    for (var i = 1; i < analysisRows.length; i++) {
      var date = formatDate_(analysisRows[i][0]);
      var member = String(analysisRows[i][1]);
      var commitCount = Number(analysisRows[i][2]) || 0;
      var hours = analysisRows[i][3] === '' || analysisRows[i][3] === null ? null : Number(analysisRows[i][3]);
      var status = String(analysisRows[i][4]);
      var projects = String(analysisRows[i][5]);
      if (!date || !member) continue;

      if (!analysis[date]) analysis[date] = {};
      analysis[date][member] = { status: status, commitCount: commitCount, hours: hours };

      // Track project contributors for risk detection
      if (projects) {
        var projList = projects.split(', ');
        for (var j = 0; j < projList.length; j++) {
          if (!projectContributors[projList[j]]) projectContributors[projList[j]] = {};
          projectContributors[projList[j]][member] = true;
        }
      }
    }

    // Identify single-contributor projects
    var projNames = Object.keys(projectContributors);
    for (var i = 0; i < projNames.length; i++) {
      var contributors = Object.keys(projectContributors[projNames[i]]);
      if (contributors.length === 1) {
        projectRisks.push({ project: projNames[i], soloContributor: contributors[0], severity: '🟡' });
      }
    }
  }

  return JSON.stringify({ commits: commits, analysis: analysis, projectRisks: projectRisks });
}

function writeTaskAnalysis_(ss, taskAnalysis) {
  var sheet = ss.getSheetByName('Task Analysis');
  if (!sheet) sheet = ss.insertSheet('Task Analysis');

  var existing = sheet.getDataRange().getValues();
  var existingKeyRows = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][1]) + '|' + String(existing[i][2]) + '|' + String(existing[i][3]);
    existingKeyRows[key] = i + 1;
  }

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 9).setValues([['analysisDate', 'period', 'date', 'member', 'severity', 'type', 'task', 'commits', 'reasoning']]);
    existing = [['header']];
  }

  var warnings = taskAnalysis.warnings || [];
  var analysisDate = taskAnalysis.analysisDate || '';
  var period = taskAnalysis.period || '';
  var newRows = [];

  for (var i = 0; i < warnings.length; i++) {
    var w = warnings[i];
    var key = String(period) + '|' + String(w.date) + '|' + String(w.member);
    var row = [analysisDate, period, w.date, w.member, w.severity, w.type, w.task, w.commits, w.reasoning];
    if (existingKeyRows[key]) {
      sheet.getRange(existingKeyRows[key], 1, 1, 9).setValues([row]);
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 9).setValues(newRows);
  }
}

/**
 * Returns task analysis data as JSON string (called from client via google.script.run).
 * Returns the most recent period's data. Returns null if no sheet exists.
 */
function getTaskAnalysisData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Task Analysis');
  if (!sheet) return JSON.stringify(null);

  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return JSON.stringify(null);

  // Find the latest analysisDate
  var latestDate = '';
  for (var i = 1; i < rows.length; i++) {
    var d = String(rows[i][0]);
    if (d > latestDate) latestDate = d;
  }

  // Collect warnings for the latest analysisDate
  var warnings = [];
  var period = '';
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== latestDate) continue;
    period = String(rows[i][1]);
    warnings.push({
      date: String(rows[i][2]),
      member: String(rows[i][3]),
      severity: String(rows[i][4]),
      type: String(rows[i][5]),
      task: String(rows[i][6]),
      commits: String(rows[i][7]),
      reasoning: String(rows[i][8])
    });
  }

  // Compute summary
  var critical = 0, warning = 0, caution = 0;
  for (var i = 0; i < warnings.length; i++) {
    var s = warnings[i].severity;
    if (s === '🔴') critical++;
    else if (s === '🟡') warning++;
    else if (s === '🟠') caution++;
  }

  return JSON.stringify({
    analysisDate: latestDate,
    period: period,
    warnings: warnings,
    summary: { totalWarnings: warnings.length, critical: critical, warning: warning, caution: caution }
  });
}

// --- Read helpers ---

function readRawData_(ss) {
  var sheet = ss.getSheetByName('rawData');
  if (!sheet) return {};

  var rows = sheet.getDataRange().getValues();
  var rawData = {};
  for (var i = 1; i < rows.length; i++) {
    var date = formatDate_(rows[i][0]);
    var member = String(rows[i][1]);
    var total = rows[i][2];
    var meeting = rows[i][3];
    var dev = rows[i][4];

    if (!rawData[date]) rawData[date] = {};
    rawData[date][member] = {
      total: total === '' || total === null ? null : Number(total),
      meeting: meeting === '' || meeting === null ? null : Number(meeting),
      dev: dev === '' || dev === null ? null : Number(dev)
    };
  }
  return rawData;
}

function readIssues_(ss) {
  var sheet = ss.getSheetByName('issues');
  if (!sheet) return [];

  var rows = sheet.getDataRange().getValues();
  var issues = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      issues.push({ member: String(rows[i][0]), severity: String(rows[i][1]), text: String(rows[i][2]) });
    }
  }
  return issues;
}

function readLeave_(ss) {
  var sheet = ss.getSheetByName('leave');
  if (!sheet) return {};

  var rows = sheet.getDataRange().getValues();
  var leave = {};
  for (var i = 1; i < rows.length; i++) {
    var member = String(rows[i][0]);
    if (!member) continue;
    if (!leave[member]) leave[member] = [];
    leave[member].push({ start: formatDate_(rows[i][1]), end: formatDate_(rows[i][2]) });
  }
  return leave;
}

function formatDate_(val) {
  if (val instanceof Date) {
    return (val.getMonth() + 1) + '/' + val.getDate();
  }
  return String(val);
}

function dateToNum_(d) {
  var parts = String(d).split('/');
  return Number(parts[0]) * 100 + Number(parts[1]);
}
