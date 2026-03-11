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

  writeRawData_(ss, data.rawData);
  writeIssues_(ss, data.issues || []);
  writeLeave_(ss, data.leave || {});
  writeDailyUpdates_(ss, data.dailyUpdates || []);

  var dateCount = Object.keys(data.rawData).length;
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', dates: dateCount }))
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
