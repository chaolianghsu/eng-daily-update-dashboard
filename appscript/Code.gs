/**
 * Serves the dashboard HTML page.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('工程部 Daily Update Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Builds lookup maps from a POST payload's centers + parentCenters blocks.
 *
 * Returns:
 *   memberToDept   {Joyce: '工程', Richard: '技發', ...}
 *   deptToParent   {工程: '產品中心', 技發: '產品中心'}
 *   deptToLabel    {工程: '工程部', 技發: '技術發展部'}
 *   parentToLabel  {產品中心: '產品中心'}
 *
 * Safe when payload lacks centers or parentCenters — returns empty maps,
 * which makes every prepended `parentCenter` / `department` column an empty
 * string (graceful degradation for old payloads).
 */
function buildLookups_(data) {
  var memberToDept = {};
  var deptToParent = {};
  var deptToLabel = {};
  var parentToLabel = {};

  if (data && data.centers) {
    var deptNames = Object.keys(data.centers);
    for (var i = 0; i < deptNames.length; i++) {
      var dept = deptNames[i];
      var c = data.centers[dept] || {};
      deptToLabel[dept] = c.label || dept;
      if (c.parent) deptToParent[dept] = c.parent;
      var members = c.members || [];
      for (var j = 0; j < members.length; j++) {
        memberToDept[members[j]] = dept;
      }
    }
  }
  if (data && data.parentCenters) {
    var parentNames = Object.keys(data.parentCenters);
    for (var k = 0; k < parentNames.length; k++) {
      var p = parentNames[k];
      parentToLabel[p] = (data.parentCenters[p] && data.parentCenters[p].label) || p;
    }
  }
  return {
    memberToDept: memberToDept,
    deptToParent: deptToParent,
    deptToLabel: deptToLabel,
    parentToLabel: parentToLabel
  };
}

/**
 * Resolves the {parentCenter, department} pair for a member using lookups.
 * Both fields default to '' when not found — preserves graceful degradation.
 */
function resolveOrg_(member, lookups) {
  var dept = (lookups && lookups.memberToDept[member]) || '';
  var parent = dept ? (lookups.deptToParent[dept] || '') : '';
  return { parent: parent, dept: dept };
}

/**
 * Receives JSON data from Claude sync skill and writes to Sheets.
 *
 * Expected payload (multi-center schema):
 *   { rawData, issues, leave, dailyUpdates, gitlabCommits, commitAnalysis,
 *     taskAnalysis, planAnalysis, centers, parentCenters }
 *
 * Schema notes:
 *   - Every per-member sheet PREPENDS two columns: `parentCenter`, `department`.
 *     New columns are added at the LEFT so manual pivot formulas referencing
 *     downstream columns shift by a constant offset.
 *   - Dedup keys include `department` so members appearing in multiple
 *     departments (e.g. cross-space contributors) don't collide on date|member.
 *   - Three new sheets: `Centers`, `Departments`, `Items` (derived).
 *   - Migration from the old (no parent/dept) schema requires a one-shot
 *     `clearSheets` POST listing every sheet to clear, followed by a normal
 *     full-data POST. See docs/appscript-migration.md.
 */
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var lookups = buildLookups_(data);

  // Clear specified sheets before writing (for rebuild / schema migration)
  if (data.clearSheets) {
    var sheetsToClean = Array.isArray(data.clearSheets) ? data.clearSheets : [data.clearSheets];
    for (var i = 0; i < sheetsToClean.length; i++) {
      var sheetToClear = ss.getSheetByName(sheetsToClean[i]);
      if (sheetToClear) sheetToClear.clear();
    }
  }

  // Remove duplicate rows from specified sheets (keeps first occurrence)
  if (data.dedupSheets) {
    var dedupResult = dedupSheets_(ss, data.dedupSheets);
    return ContentService.createTextOutput(JSON.stringify(dedupResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Reference sheets first — describe the org structure
  if (data.parentCenters) writeCenters_(ss, data.parentCenters, lookups);
  if (data.centers) writeDepartments_(ss, data.centers, lookups);

  // Per-member sheets
  if (data.rawData) writeRawData_(ss, data.rawData, lookups);
  if (data.issues) writeIssues_(ss, data.issues, lookups);
  if (data.leave) writeLeave_(ss, data.leave, lookups);
  if (data.dailyUpdates) writeDailyUpdates_(ss, data.dailyUpdates, lookups);
  if (data.gitlabCommits) writeCommits_(ss, data.gitlabCommits, lookups);
  if (data.commitAnalysis) writeCommitAnalysis_(ss, data.commitAnalysis, lookups);
  if (data.taskAnalysis) writeTaskAnalysis_(ss, data.taskAnalysis, lookups);
  if (data.planAnalysis) writePlanAnalysis_(ss, data.planAnalysis, lookups);

  // Derived view — full rebuild every POST
  var itemsWritten = 0;
  if (data.rawData) itemsWritten = writeItems_(ss, data.rawData, lookups);

  var result = { status: 'ok' };
  if (data.rawData) result.dates = Object.keys(data.rawData).length;
  if (data.gitlabCommits) result.commits = data.gitlabCommits.length;
  if (data.taskAnalysis) result.taskWarnings = data.taskAnalysis.warnings ? data.taskAnalysis.warnings.length : 0;
  if (data.planAnalysis) result.planSpecs = (data.planAnalysis.planSpecs || []).length;
  if (data.rawData) result.items = itemsWritten;
  if (data.parentCenters) result.parentCenters = Object.keys(data.parentCenters).length;
  if (data.centers) result.departments = Object.keys(data.centers).length;
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

function writeRawData_(ss, rawData, lookups) {
  var sheet = ss.getSheetByName('rawData');
  if (!sheet) sheet = ss.insertSheet('rawData');
  sheet.clear();

  // Schema: parentCenter | department | date | member | total | meeting | dev
  var rows = [['parentCenter', 'department', 'date', 'member', 'total', 'meeting', 'dev']];
  var dates = Object.keys(rawData).sort(function(a, b) {
    return dateToNum_(a) - dateToNum_(b);
  });

  for (var i = 0; i < dates.length; i++) {
    var date = dates[i];
    var members = Object.keys(rawData[date]);
    for (var j = 0; j < members.length; j++) {
      var m = members[j];
      var h = rawData[date][m];
      var org = resolveOrg_(m, lookups);
      rows.push([org.parent, org.dept, date, m, h.total, h.meeting, h.dev]);
    }
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 7).setValues(rows);
  }
}

function writeIssues_(ss, issues, lookups) {
  var sheet = ss.getSheetByName('issues');
  if (!sheet) sheet = ss.insertSheet('issues');
  sheet.clear();

  // Schema: parentCenter | department | member | severity | text
  var rows = [['parentCenter', 'department', 'member', 'severity', 'text']];
  for (var i = 0; i < issues.length; i++) {
    var org = resolveOrg_(issues[i].member, lookups);
    rows.push([org.parent, org.dept, issues[i].member, issues[i].severity, issues[i].text]);
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  }
}

function writeLeave_(ss, leave, lookups) {
  var sheet = ss.getSheetByName('leave');
  if (!sheet) sheet = ss.insertSheet('leave');
  sheet.clear();

  // Schema: parentCenter | department | member | start | end
  var rows = [['parentCenter', 'department', 'member', 'start', 'end']];
  var members = Object.keys(leave);
  for (var i = 0; i < members.length; i++) {
    var ranges = leave[members[i]];
    var org = resolveOrg_(members[i], lookups);
    for (var j = 0; j < ranges.length; j++) {
      rows.push([org.parent, org.dept, members[i], ranges[j].start, ranges[j].end]);
    }
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  }
}

function writeDailyUpdates_(ss, dailyUpdates, lookups) {
  var sheet = ss.getSheetByName('Daily Updates');
  if (!sheet) sheet = ss.insertSheet('Daily Updates');

  // Schema: parentCenter | department | 日期 | 成員 | 時間 | 原始內容 | 上一個工作日的工時
  // Dedup key: date|dept|member (date col idx 2, dept col idx 1, member col idx 3)
  // Including dept handles cross-space members.
  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    var key = formatDate_(existing[i][2]) + '|' + String(existing[i][1]) + '|' + String(existing[i][3]);
    existingKeys[key] = true;
  }

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 7).setValues([['parentCenter', 'department', '日期', '成員', '時間', '原始內容', '上一個工作日的工時']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var j = 0; j < dailyUpdates.length; j++) {
    var u = dailyUpdates[j];
    var org = resolveOrg_(u.member, lookups);
    var dedupKey = String(u.date) + '|' + String(org.dept) + '|' + String(u.member);
    if (existingKeys[dedupKey]) continue;

    var time = '';
    if (u.createTime) {
      var d = new Date(u.createTime);
      var hours = d.getHours();
      var minutes = d.getMinutes();
      var period = hours < 12 ? '上午' : '下午';
      var displayHour = hours <= 12 ? hours : hours - 12;
      time = period + ' ' + displayHour + ':' + (minutes < 10 ? '0' : '') + minutes;
    }

    newRows.push([org.parent, org.dept, u.date, u.member, time, u.text || '', u.total === null ? '' : u.total]);
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 7).setValues(newRows);
  }
}

function writeCommits_(ss, commits, lookups) {
  // Schema: parentCenter | department | 日期 | 成員 | Project | Commit Title | SHA | URL | Source
  // Dedup key: date|dept|member|sha (cols 2, 1, 3, 6)
  // Note: legacy "GitLab Commits" rename + Source backfill happens on the
  // old-schema (5-col) sheet only — when migrating to multi-center the user
  // should clearSheets first; the rename path is kept as a fallback.
  var sheet = ss.getSheetByName('Commits');
  if (!sheet) {
    var oldSheet = ss.getSheetByName('GitLab Commits');
    if (oldSheet) {
      oldSheet.setName('Commits');
      sheet = oldSheet;
      var lastRow = sheet.getLastRow();
      if (lastRow >= 1) {
        sheet.getRange(1, 7).setValue('Source');
        if (lastRow > 1) {
          var fillValues = [];
          for (var r = 0; r < lastRow - 1; r++) fillValues.push(['gitlab']);
          sheet.getRange(2, 7, lastRow - 1, 1).setValues(fillValues);
        }
      }
    } else {
      sheet = ss.insertSheet('Commits');
    }
  }

  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    var key = formatDate_(existing[i][2]) + '|' + String(existing[i][1]) + '|' + String(existing[i][3]) + '|' + String(existing[i][6]);
    existingKeys[key] = true;
  }

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 9).setValues([['parentCenter', 'department', '日期', '成員', 'Project', 'Commit Title', 'SHA', 'URL', 'Source']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var j = 0; j < commits.length; j++) {
    var c = commits[j];
    var org = resolveOrg_(c.member, lookups);
    var dedupKey = String(c.date) + '|' + String(org.dept) + '|' + String(c.member) + '|' + String(c.sha);
    if (existingKeys[dedupKey]) continue;
    newRows.push([org.parent, org.dept, c.date, c.member, c.project, c.title, c.sha, c.url || '', c.source || 'gitlab']);
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 9).setValues(newRows);
  }
}

function writeCommitAnalysis_(ss, analysis, lookups) {
  var sheet = ss.getSheetByName('Commit Analysis');
  if (!sheet) sheet = ss.insertSheet('Commit Analysis');

  // Schema: parentCenter | department | 日期 | 成員 | Commits數 | Daily Update工時 | 狀態 | 參與Projects
  // Dedup key: date|dept|member (cols 2, 1, 3)
  var existing = sheet.getDataRange().getValues();
  var existingKeyRows = {};
  for (var i = 1; i < existing.length; i++) {
    var key = formatDate_(existing[i][2]) + '|' + String(existing[i][1]) + '|' + String(existing[i][3]);
    existingKeyRows[key] = i + 1;
  }

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 8).setValues([['parentCenter', 'department', '日期', '成員', 'Commits數', 'Daily Update工時', '狀態', '參與Projects']]);
    existing = [['header']];
  }

  var newRows = [];
  for (var j = 0; j < analysis.length; j++) {
    var a = analysis[j];
    var org = resolveOrg_(a.member, lookups);
    var dedupKey = String(a.date) + '|' + String(org.dept) + '|' + String(a.member);
    var row = [org.parent, org.dept, a.date, a.member, a.commitCount, a.dailyUpdateHours === null ? '' : a.dailyUpdateHours, a.status, a.projects];
    if (existingKeyRows[dedupKey]) {
      sheet.getRange(existingKeyRows[dedupKey], 1, 1, 8).setValues([row]);
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 8).setValues(newRows);
  }
}

/**
 * Returns commit data as JSON string (called from client via google.script.run).
 * Returns null (as string) if no Commits sheet exists.
 * Supports both "Commits" (new) and "GitLab Commits" (legacy) sheet names.
 *
 * Schema-aware: the new schema has parentCenter+department prepended, shifting
 * existing columns by +2. We detect which schema is in use by checking the
 * header row's first cell.
 */
function getCommitData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var commitSheet = ss.getSheetByName('Commits') || ss.getSheetByName('GitLab Commits');
  if (!commitSheet) return JSON.stringify(null);

  var commitRows = commitSheet.getDataRange().getValues();
  var numCols = commitRows.length > 0 ? commitRows[0].length : 0;
  var hasOrg = numCols >= 9 && String(commitRows[0][0]) === 'parentCenter';
  var offset = hasOrg ? 2 : 0;
  var hasSource = numCols >= (offset + 7);

  var commits = {};
  for (var i = 1; i < commitRows.length; i++) {
    var date = formatDate_(commitRows[i][offset + 0]);
    var member = String(commitRows[i][offset + 1]);
    var project = String(commitRows[i][offset + 2]);
    var title = String(commitRows[i][offset + 3]);
    var sha = String(commitRows[i][offset + 4]);
    if (!date || !member) continue;

    if (!commits[date]) commits[date] = {};
    if (!commits[date][member]) commits[date][member] = { count: 0, projects: [], items: [] };
    commits[date][member].count++;
    if (commits[date][member].projects.indexOf(project) === -1) {
      commits[date][member].projects.push(project);
    }
    var url = String(commitRows[i][offset + 5] || '');
    var source = hasSource ? String(commitRows[i][offset + 6] || 'gitlab') : 'gitlab';
    commits[date][member].items.push({ title: title, sha: sha, project: project, url: url || null, source: source });
  }

  // Read analysis
  var analysisSheet = ss.getSheetByName('Commit Analysis');
  var analysis = {};
  var projectRisks = [];
  if (analysisSheet) {
    var analysisRows = analysisSheet.getDataRange().getValues();
    var aHasOrg = analysisRows.length > 0 && String(analysisRows[0][0]) === 'parentCenter';
    var aOffset = aHasOrg ? 2 : 0;
    var projectContributors = {};
    for (var k = 1; k < analysisRows.length; k++) {
      var aDate = formatDate_(analysisRows[k][aOffset + 0]);
      var aMember = String(analysisRows[k][aOffset + 1]);
      var commitCount = Number(analysisRows[k][aOffset + 2]) || 0;
      var hoursCell = analysisRows[k][aOffset + 3];
      var hours = hoursCell === '' || hoursCell === null ? null : Number(hoursCell);
      var status = String(analysisRows[k][aOffset + 4]);
      var projects = String(analysisRows[k][aOffset + 5]);
      if (!aDate || !aMember) continue;

      if (!analysis[aDate]) analysis[aDate] = {};
      analysis[aDate][aMember] = { status: status, commitCount: commitCount, hours: hours };

      if (projects) {
        var projList = projects.split(', ');
        for (var p = 0; p < projList.length; p++) {
          if (!projectContributors[projList[p]]) projectContributors[projList[p]] = {};
          projectContributors[projList[p]][aMember] = true;
        }
      }
    }

    var projNames = Object.keys(projectContributors);
    for (var n = 0; n < projNames.length; n++) {
      var contributors = Object.keys(projectContributors[projNames[n]]);
      if (contributors.length === 1) {
        projectRisks.push({ project: projNames[n], soloContributor: contributors[0], severity: '🟡' });
      }
    }
  }

  return JSON.stringify({ commits: commits, analysis: analysis, projectRisks: projectRisks });
}

function writeTaskAnalysis_(ss, taskAnalysis, lookups) {
  var sheet = ss.getSheetByName('Task Analysis');
  if (!sheet) sheet = ss.insertSheet('Task Analysis');

  // Schema: parentCenter | department | analysisDate | period | date | member | severity | type | task | commits | reasoning
  // Dedup key: period|date|dept|member (cols 3, 4, 1, 5)
  var existing = sheet.getDataRange().getValues();
  var existingKeyRows = {};
  for (var i = 1; i < existing.length; i++) {
    var key = String(existing[i][3]) + '|' + formatDate_(existing[i][4]) + '|' + String(existing[i][1]) + '|' + String(existing[i][5]);
    existingKeyRows[key] = i + 1;
  }

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, 11).setValues([['parentCenter', 'department', 'analysisDate', 'period', 'date', 'member', 'severity', 'type', 'task', 'commits', 'reasoning']]);
    existing = [['header']];
  }

  var warnings = taskAnalysis.warnings || [];
  var analysisDate = taskAnalysis.analysisDate || '';
  var period = taskAnalysis.period || '';
  var newRows = [];

  for (var j = 0; j < warnings.length; j++) {
    var w = warnings[j];
    var org = resolveOrg_(w.member, lookups);
    var dedupKey = String(period) + '|' + String(w.date) + '|' + String(org.dept) + '|' + String(w.member);
    var row = [org.parent, org.dept, analysisDate, period, w.date, w.member, w.severity, w.type, w.task, w.commits, w.reasoning];
    if (existingKeyRows[dedupKey]) {
      sheet.getRange(existingKeyRows[dedupKey], 1, 1, 11).setValues([row]);
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length > 0) {
    var startRow = existing.length + 1;
    sheet.getRange(startRow, 1, newRows.length, 11).setValues(newRows);
  }
}

function writePlanAnalysis_(ss, planAnalysis, lookups) {
  // Plan Specs — schema: parentCenter | department | date | member | project | commitTitle | sha | files
  // Dedup key: date|dept|member|sha (cols 2, 1, 3, 6)
  var specsSheet = ss.getSheetByName('Plan Specs');
  if (!specsSheet) specsSheet = ss.insertSheet('Plan Specs');

  var specsExisting = specsSheet.getDataRange().getValues();
  var specsKeys = {};
  for (var i = 1; i < specsExisting.length; i++) {
    var key = formatDate_(specsExisting[i][2]) + '|' + String(specsExisting[i][1]) + '|' + String(specsExisting[i][3]) + '|' + String(specsExisting[i][6]);
    specsKeys[key] = true;
  }

  if (specsExisting.length === 0) {
    specsSheet.getRange(1, 1, 1, 8).setValues([['parentCenter', 'department', 'date', 'member', 'project', 'commitTitle', 'sha', 'files']]);
    specsExisting = [['header']];
  }

  var specsRows = [];
  (planAnalysis.planSpecs || []).forEach(function(s) {
    var org = resolveOrg_(s.member, lookups);
    var dedupKey = String(s.date) + '|' + String(org.dept) + '|' + String(s.member) + '|' + String(s.commit.sha);
    if (specsKeys[dedupKey]) return;
    specsRows.push([org.parent, org.dept, s.date, s.member, s.commit.project, s.commit.title, s.commit.sha, s.files.join(', ')]);
  });
  if (specsRows.length > 0) {
    var startRow = specsExisting.length + 1;
    specsSheet.getRange(startRow, 1, specsRows.length, 8).setValues(specsRows);
  }

  // Plan Correlations — schema: parentCenter | department | date | member | status | specCommits | matchedTasks | reasoning
  // Dedup key: date|dept|member (cols 2, 1, 3)
  var corrSheet = ss.getSheetByName('Plan Correlations');
  if (!corrSheet) corrSheet = ss.insertSheet('Plan Correlations');

  var corrExisting = corrSheet.getDataRange().getValues();
  var corrKeys = {};
  for (var i = 1; i < corrExisting.length; i++) {
    var key = formatDate_(corrExisting[i][2]) + '|' + String(corrExisting[i][1]) + '|' + String(corrExisting[i][3]);
    corrKeys[key] = true;
  }

  if (corrExisting.length === 0) {
    corrSheet.getRange(1, 1, 1, 8).setValues([['parentCenter', 'department', 'date', 'member', 'status', 'specCommits', 'matchedTasks', 'reasoning']]);
    corrExisting = [['header']];
  }

  var corrRows = [];
  (planAnalysis.correlations || []).forEach(function(c) {
    var org = resolveOrg_(c.member, lookups);
    var dedupKey = String(c.date) + '|' + String(org.dept) + '|' + String(c.member);
    if (corrKeys[dedupKey]) return;
    corrRows.push([org.parent, org.dept, c.date, c.member, c.status, c.specCommits, (c.matchedTasks || []).join(', '), c.reasoning || '']);
  });
  if (corrRows.length > 0) {
    var startRow = corrExisting.length + 1;
    corrSheet.getRange(startRow, 1, corrRows.length, 8).setValues(corrRows);
  }
}

/**
 * Writes the Centers reference sheet.
 * Schema: parentCenter | label | departments (comma-joined list)
 */
function writeCenters_(ss, parentCenters, lookups) {
  var sheet = ss.getSheetByName('Centers');
  if (!sheet) sheet = ss.insertSheet('Centers');
  sheet.clear();

  var rows = [['parentCenter', 'label', 'departments']];
  var names = Object.keys(parentCenters);
  for (var i = 0; i < names.length; i++) {
    var p = parentCenters[names[i]] || {};
    var children = p.children || [];
    var label = p.label || names[i];
    rows.push([names[i], label, children.join(', ')]);
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  }
}

/**
 * Writes the Departments reference sheet.
 * Schema: department | label | parentCenter | members (comma-joined list)
 */
function writeDepartments_(ss, centers, lookups) {
  var sheet = ss.getSheetByName('Departments');
  if (!sheet) sheet = ss.insertSheet('Departments');
  sheet.clear();

  var rows = [['department', 'label', 'parentCenter', 'members']];
  var names = Object.keys(centers);
  for (var i = 0; i < names.length; i++) {
    var c = centers[names[i]] || {};
    var label = c.label || names[i];
    var parent = c.parent || '';
    var members = c.members || [];
    rows.push([names[i], label, parent, members.join(', ')]);
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  }
}

/**
 * Writes the Items derived sheet — one row per task item.
 * Schema: parentCenter | department | date | member | code | hours
 *
 * Full rebuild every POST (clear → write all). Skips members whose total is
 * null or whose items array is empty/missing. Returns the number of data rows
 * written (header excluded).
 */
function writeItems_(ss, rawData, lookups) {
  var sheet = ss.getSheetByName('Items');
  if (!sheet) sheet = ss.insertSheet('Items');
  sheet.clear();

  var rows = [['parentCenter', 'department', 'date', 'member', 'code', 'hours']];
  var dates = Object.keys(rawData).sort(function(a, b) {
    return dateToNum_(a) - dateToNum_(b);
  });

  for (var i = 0; i < dates.length; i++) {
    var date = dates[i];
    var members = Object.keys(rawData[date]);
    for (var j = 0; j < members.length; j++) {
      var m = members[j];
      var h = rawData[date][m] || {};
      if (h.total === null || h.total === undefined) continue;
      var items = h.items || [];
      if (!items.length) continue;
      var org = resolveOrg_(m, lookups);
      for (var k = 0; k < items.length; k++) {
        var it = items[k] || {};
        var code = (it.code === null || it.code === undefined) ? '' : String(it.code);
        var hrs = (it.hours === null || it.hours === undefined) ? '' : it.hours;
        rows.push([org.parent, org.dept, date, m, code, hrs]);
      }
    }
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  }
  return rows.length - 1;
}

/**
 * Returns task analysis data as JSON string (called from client via google.script.run).
 * Returns the most recent period's data. Returns null if no sheet exists.
 *
 * Schema-aware: detects whether the sheet has parentCenter+department prepended.
 */
function getTaskAnalysisData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Task Analysis');
  if (!sheet) return JSON.stringify(null);

  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return JSON.stringify(null);

  var hasOrg = String(rows[0][0]) === 'parentCenter';
  var offset = hasOrg ? 2 : 0;

  // Find the latest analysisDate (col offset+0)
  var latestDate = '';
  for (var i = 1; i < rows.length; i++) {
    var d = String(rows[i][offset + 0]);
    if (d > latestDate) latestDate = d;
  }

  var warnings = [];
  var period = '';
  for (var j = 1; j < rows.length; j++) {
    if (String(rows[j][offset + 0]) !== latestDate) continue;
    period = String(rows[j][offset + 1]);
    warnings.push({
      date: String(rows[j][offset + 2]),
      member: String(rows[j][offset + 3]),
      severity: String(rows[j][offset + 4]),
      type: String(rows[j][offset + 5]),
      task: String(rows[j][offset + 6]),
      commits: String(rows[j][offset + 7]),
      reasoning: String(rows[j][offset + 8])
    });
  }

  var critical = 0, warning = 0, caution = 0;
  for (var k = 0; k < warnings.length; k++) {
    var s = warnings[k].severity;
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
  if (rows.length === 0) return {};
  var hasOrg = String(rows[0][0]) === 'parentCenter';
  var offset = hasOrg ? 2 : 0;

  var rawData = {};
  for (var i = 1; i < rows.length; i++) {
    var date = formatDate_(rows[i][offset + 0]);
    var member = String(rows[i][offset + 1]);
    var total = rows[i][offset + 2];
    var meeting = rows[i][offset + 3];
    var dev = rows[i][offset + 4];

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
  if (rows.length === 0) return [];
  var hasOrg = String(rows[0][0]) === 'parentCenter';
  var offset = hasOrg ? 2 : 0;

  var issues = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][offset + 0]) {
      issues.push({
        member: String(rows[i][offset + 0]),
        severity: String(rows[i][offset + 1]),
        text: String(rows[i][offset + 2])
      });
    }
  }
  return issues;
}

function readLeave_(ss) {
  var sheet = ss.getSheetByName('leave');
  if (!sheet) return {};

  var rows = sheet.getDataRange().getValues();
  if (rows.length === 0) return {};
  var hasOrg = String(rows[0][0]) === 'parentCenter';
  var offset = hasOrg ? 2 : 0;

  var leave = {};
  for (var i = 1; i < rows.length; i++) {
    var member = String(rows[i][offset + 0]);
    if (!member) continue;
    if (!leave[member]) leave[member] = [];
    leave[member].push({ start: formatDate_(rows[i][offset + 1]), end: formatDate_(rows[i][offset + 2]) });
  }
  return leave;
}

/**
 * Dedup key config per sheet — which 0-based columns form the unique key.
 *
 * After the multi-center migration, every sheet has `parentCenter` (col 0)
 * and `department` (col 1) prepended. So the date|member-style keys shift to
 * `date|dept|member`. Including dept is what handles cross-space members
 * like contributors who appear in multiple departments — without it,
 * date|member would collide.
 *
 * 'date' columns are normalized via formatDate_().
 */
var DEDUP_KEY_CONFIG = {
  // date(2) | dept(1) | member(3)
  'Daily Updates':    { cols: [0, 2, 3], dateCols: [0] },
  // date(2) | dept(1) | member(3) | sha(6)
  'Commits':          { cols: [0, 2, 3, 6], dateCols: [0] },
  // legacy 5-col schema — kept for back-compat with un-migrated sheets
  'GitLab Commits':   { cols: [0, 1, 4], dateCols: [0] },
  // date(2) | dept(1) | member(3)
  'Commit Analysis':  { cols: [0, 2, 3], dateCols: [0] },
  // period(3) | date(4) | dept(1) | member(5)
  'Task Analysis':    { cols: [3, 4, 1, 5], dateCols: [4] },
  // date(2) | dept(1) | member(3) | sha(6)
  'Plan Specs':        { cols: [0, 2, 3, 6], dateCols: [0] },
  // date(2) | dept(1) | member(3)
  'Plan Correlations': { cols: [0, 2, 3], dateCols: [0] }
};

function dedupSheets_(ss, sheetNames) {
  var names = Array.isArray(sheetNames) ? sheetNames : [sheetNames];
  var report = { status: 'ok', dedup: {} };

  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    var config = DEDUP_KEY_CONFIG[name];
    if (!config) { report.dedup[name] = 'unknown sheet'; continue; }

    var sheet = ss.getSheetByName(name);
    if (!sheet) { report.dedup[name] = 'not found'; continue; }

    var rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) { report.dedup[name] = 0; continue; }

    var seen = {};
    var rowsToDelete = [];

    for (var i = 1; i < rows.length; i++) {
      var parts = [];
      for (var c = 0; c < config.cols.length; c++) {
        var col = config.cols[c];
        var val = (config.dateCols.indexOf(col) >= 0)
          ? formatDate_(rows[i][col])
          : String(rows[i][col]);
        parts.push(val);
      }
      var key = parts.join('|');
      if (seen[key]) {
        rowsToDelete.push(i + 1);
      } else {
        seen[key] = true;
      }
    }

    for (var d = rowsToDelete.length - 1; d >= 0; d--) {
      sheet.deleteRow(rowsToDelete[d]);
    }
    report.dedup[name] = rowsToDelete.length;
  }

  return report;
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
