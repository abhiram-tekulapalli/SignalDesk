/**
 * SignalDesk — Google Sheets Database Service (SignalDesk_DB)
 *
 * Manages the four database tabs using batch reads/writes:
 * - Sources
 * - SeenEmails
 * - Stories
 * - Runs
 */

/**
 * Finds the configured SignalDesk_DB spreadsheet or creates a new private one.
 * Persists SPREADSHEET_ID into Script Properties.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function initializeSpreadsheet() {
  const existingId = getScriptProperty('SPREADSHEET_ID', '');
  let spreadsheet = null;

  if (existingId) {
    try {
      spreadsheet = SpreadsheetApp.openById(existingId);
      logInfo('StorageService', 'Opened existing spreadsheet: ' + spreadsheet.getName());
    } catch (err) {
      logWarn(
        'StorageService',
        'Configured SPREADSHEET_ID could not be opened; creating a fresh SignalDesk_DB.',
        err
      );
      spreadsheet = null;
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create(SIGNALDESK_APP.DB_NAME);
    setScriptProperty('SPREADSHEET_ID', spreadsheet.getId());
    logInfo('StorageService', 'Created new private spreadsheet SignalDesk_DB with ID: ' + spreadsheet.getId());
  }

  initializeSheets(spreadsheet);
  return spreadsheet;
}

/**
 * Ensures all four required tabs exist with exact header columns and clean formatting.
 * Removes the default empty "Sheet1" if it is unused.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function initializeSheets(spreadsheet) {
  const ss = spreadsheet || getSpreadsheet();
  const requiredTabs = [
    SHEET_NAMES.SOURCES,
    SHEET_NAMES.SEEN_EMAILS,
    SHEET_NAMES.STORIES,
    SHEET_NAMES.RUNS,
  ];

  for (let i = 0; i < requiredTabs.length; i++) {
    const tabName = requiredTabs[i];
    const headers = SHEET_HEADERS[tabName];
    let sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      logInfo('StorageService', 'Created missing tab: ' + tabName);
    }

    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    const firstRow =
      sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

    const headersMatch =
      firstRow.length >= headers.length &&
      headers.every(function (h, idx) {
        return String(firstRow[idx] || '').trim() === h;
      });

    if (!headersMatch) {
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      } else {
        sheet.insertRowBefore(1);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
    } else if (sheet.getFrozenRows() < 1) {
      sheet.setFrozenRows(1);
    }
  }

  // Remove default Sheet1 only if it exists and is completely blank
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 4) {
    ss.deleteSheet(defaultSheet);
  }

  return ss;
}

/**
 * Opens the configured SignalDesk_DB spreadsheet.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  const spreadsheetId = getScriptProperty('SPREADSHEET_ID', '');
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID is not set. Run setupSignalDesk() first.');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

/**
 * Helper to fetch a named tab, auto-initializing schema if missing.
 * @param {string} tabName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getRequiredSheet_(tabName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    initializeSheets(ss);
    sheet = ss.getSheetByName(tabName);
  }
  return sheet;
}

/**
 * Reads the Sources tab and returns all enabled approved newsletter sources.
 * Uses a single batch getValues() call.
 * @returns {Array<Object>}
 */
function getApprovedNewsletters() {
  const sheet = getRequiredSheet_(SHEET_NAMES.SOURCES);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.Sources.length).getValues();
  const approved = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const senderEmail = String(row[2] || '').trim().toLowerCase();
    const enabledRaw = row[5];
    const isEnabled =
      enabledRaw === true ||
      String(enabledRaw).trim().toLowerCase() === 'true' ||
      String(enabledRaw).trim().toLowerCase() === 'yes' ||
      String(enabledRaw).trim() === '1';

    if (!senderEmail || !isEnabled) {
      continue;
    }

    approved.push({
      sourceId: String(row[0] || 'src_' + (i + 1)).trim(),
      publisher: String(row[1] || senderEmail).trim(),
      senderEmail: senderEmail,
      category: String(row[3] || '').trim(),
      reliabilityNotes: String(row[4] || '').trim(),
      enabled: true,
      subscribedAt: row[6] ? String(row[6]) : '',
    });
  }

  return approved;
}

/**
 * Optional helper for first-time users: inserts 3 DISABLED sample rows into Sources
 * if the Sources tab is empty so column formatting is immediately clear.
 */
function seedSampleSourcesSheet() {
  const sheet = getRequiredSheet_(SHEET_NAMES.SOURCES);
  if (sheet.getLastRow() > 1) {
    logInfo('StorageService', 'Sources sheet already contains rows; skipping sample seed.');
    return;
  }

  const nowDate = formatDateInTimezone(new Date(), SIGNALDESK_DEFAULTS.TIMEZONE, 'yyyy-MM-dd');
  const samples = [
    [
      'src_001',
      'TLDR AI',
      'dan@tldrnewsletter.com',
      'AI & Machine Learning',
      'High-signal daily AI roundup (set enabled to TRUE after subscribing)',
      false,
      nowDate,
    ],
    [
      'src_002',
      'ByteByteGo',
      'bytebytego@substack.com',
      'Programming & Developer Tools',
      'System design & backend architecture deep dives',
      false,
      nowDate,
    ],
    [
      'src_003',
      'Risky Business',
      'news@risky.biz',
      'Cybersecurity',
      'Trusted security engineering coverage',
      false,
      nowDate,
    ],
  ];

  sheet.getRange(2, 1, samples.length, SHEET_HEADERS.Sources.length).setValues(samples);
  logInfo('StorageService', 'Inserted 3 disabled example rows into Sources tab.');
}

/**
 * Loads all SeenEmails records into a lookup map keyed by Gmail message_id.
 * @returns {Object<string, {rowIndex: number, messageId: string, sender: string, subject: string, receivedAt: string, processedAt: string, status: string, runId: string}>}
 */
function getSeenEmailMap() {
  const sheet = getRequiredSheet_(SHEET_NAMES.SEEN_EMAILS);
  const lastRow = sheet.getLastRow();
  const map = {};

  if (lastRow <= 1) {
    return map;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.SeenEmails.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    const messageId = String(rows[i][0] || '').trim();
    if (!messageId) continue;
    map[messageId] = {
      rowIndex: i + 2,
      messageId: messageId,
      sender: String(rows[i][1] || ''),
      subject: String(rows[i][2] || ''),
      receivedAt: String(rows[i][3] || ''),
      processedAt: String(rows[i][4] || ''),
      status: String(rows[i][5] || '').toUpperCase(),
      runId: String(rows[i][6] || ''),
    };
  }

  return map;
}

/**
 * Batch upserts email processing records into the SeenEmails tab.
 * Existing message IDs (e.g. previously FAILED emails being retried) are updated in place;
 * new message IDs are appended in a single batch setValues() call.
 *
 * @param {Array<{messageId: string, sender: string, subject: string, receivedAt: string, status: string}>} emailRecords
 * @param {string} runId
 */
function saveProcessedEmails(emailRecords, runId) {
  if (!emailRecords || emailRecords.length === 0) return;

  const sheet = getRequiredSheet_(SHEET_NAMES.SEEN_EMAILS);
  const existingMap = getSeenEmailMap();
  const nowIso = new Date().toISOString();
  const newRows = [];

  for (let i = 0; i < emailRecords.length; i++) {
    const rec = emailRecords[i];
    if (!rec || !rec.messageId) continue;

    const rowValues = [
      String(rec.messageId),
      String(rec.sender || '').slice(0, 200),
      String(rec.subject || '').slice(0, 300),
      String(rec.receivedAt || ''),
      nowIso,
      String(rec.status || 'PROCESSING').toUpperCase(),
      String(runId || ''),
    ];

    const existing = existingMap[rec.messageId];
    if (existing && existing.rowIndex >= 2) {
      sheet.getRange(existing.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      newRows.push(rowValues);
    }
  }

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, SHEET_HEADERS.SeenEmails.length).setValues(newRows);
  }
}

/**
 * Updates only the status, processed_at, and run_id columns for a list of message IDs.
 * Call this AFTER Gemini & Telegram delivery succeed to mark emails as SUCCESS,
 * or mark as FAILED on downstream error so the next run recovers them.
 *
 * @param {string[]} messageIds
 * @param {'PROCESSING'|'SUCCESS'|'FAILED'|'SKIPPED_EMPTY'} status
 * @param {string} runId
 */
function updateEmailStatuses(messageIds, status, runId) {
  if (!messageIds || messageIds.length === 0) return;

  const sheet = getRequiredSheet_(SHEET_NAMES.SEEN_EMAILS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const idSet = {};
  for (let i = 0; i < messageIds.length; i++) {
    idSet[String(messageIds[i])] = true;
  }

  const range = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.SeenEmails.length);
  const values = range.getValues();
  const nowIso = new Date().toISOString();
  let modified = false;

  for (let r = 0; r < values.length; r++) {
    const msgId = String(values[r][0] || '').trim();
    if (idSet[msgId]) {
      values[r][4] = nowIso;
      values[r][5] = String(status).toUpperCase();
      values[r][6] = String(runId || values[r][6] || '');
      modified = true;
    }
  }

  if (modified) {
    range.setValues(values);
  }
}

/**
 * Retrieves stories recorded in the last N days for cross-day deduplication.
 * @param {number} [lookbackDays]
 * @returns {Array<Object>}
 */
function getRecentStories(lookbackDays) {
  const days = lookbackDays || SIGNALDESK_DEFAULTS.DEDUP_LOOKBACK_DAYS;
  const sheet = getRequiredSheet_(SHEET_NAMES.STORIES);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Read at most the last 250 rows to keep Sheets I/O fast
  const maxRowsToRead = 250;
  const startRow = Math.max(2, lastRow - maxRowsToRead + 1);
  const numRows = lastRow - startRow + 1;
  const rows = sheet.getRange(startRow, 1, numRows, SHEET_HEADERS.Stories.length).getValues();

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const firstSeenRaw = row[8];
    const firstSeenMs = firstSeenRaw ? new Date(firstSeenRaw).getTime() : NaN;
    if (!isNaN(firstSeenMs) && firstSeenMs < cutoffMs) {
      continue;
    }

    const rawUrls = String(row[5] || '')
      .split(/\s*\|\s*|\s*,\s*/)
      .map(function (u) {
        return u.trim();
      })
      .filter(Boolean);

    recent.push({
      storyId: String(row[0] || ''),
      headline: String(row[1] || ''),
      category: String(row[2] || ''),
      summary: String(row[3] || ''),
      importance: Number(row[4]) || 3,
      sourceUrls: rawUrls,
      publishers: String(row[6] || ''),
      storyDate: String(row[7] || ''),
      firstSeen: String(row[8] || ''),
      duplicateKey: String(row[9] || ''),
      runId: String(row[10] || ''),
    });
  }

  return recent;
}

/**
 * Batch appends selected stories from the current edition into the Stories tab.
 * @param {Array<Object>} stories
 * @param {string} runId
 */
function saveStories(stories, runId) {
  if (!stories || stories.length === 0) return;

  const sheet = getRequiredSheet_(SHEET_NAMES.STORIES);
  const nowIso = new Date().toISOString();
  const rows = [];

  for (let i = 0; i < stories.length; i++) {
    const st = stories[i];
    const sources = Array.isArray(st.sources) ? st.sources : [];
    const urls = sources
      .map(function (s) {
        return s && s.url ? s.url : '';
      })
      .filter(Boolean)
      .join(' | ');
    const publishers = sources
      .map(function (s) {
        return s && s.publisher ? s.publisher : '';
      })
      .filter(Boolean)
      .filter(function (v, idx, arr) {
        return arr.indexOf(v) === idx;
      })
      .join(', ');

    const firstPubDate =
      (sources[0] && sources[0].publication_date) ||
      st.story_date ||
      formatDateInTimezone(new Date(), SIGNALDESK_DEFAULTS.TIMEZONE, 'yyyy-MM-dd');

    const dupKey =
      st.duplicate_key || (typeof computeDuplicateKey === 'function' ? computeDuplicateKey(st) : '');

    rows.push([
      String(st.id || 'story_' + (i + 1)),
      String(st.headline || '').slice(0, 300),
      String(st.category || ''),
      String(st.summary || '').slice(0, 1000),
      Number(st.importance) || 3,
      urls.slice(0, 2000),
      publishers.slice(0, 500),
      String(firstPubDate),
      nowIso,
      String(dupKey),
      String(runId || ''),
    ]);
  }

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, SHEET_HEADERS.Stories.length).setValues(rows);
}

/**
 * Logs one execution summary row into the Runs tab.
 * Never stores secrets or raw email bodies.
 *
 * @param {Object} runMetrics
 */
function logExecution(runMetrics) {
  try {
    const sheet = getRequiredSheet_(SHEET_NAMES.RUNS);
    const m = runMetrics || {};
    const row = [
      String(m.runId || ''),
      String(m.runDate || new Date().toISOString()),
      Number(m.emailsFetched) || 0,
      Number(m.emailsProcessed) || 0,
      Number(m.storiesDetected) || 0,
      Number(m.storiesSelected) || 0,
      String(m.geminiStatus || 'NOT_RUN'),
      String(m.telegramStatus || 'NOT_RUN'),
      Number(m.executionTimeSec) || 0,
      redactSecrets(String(m.errorMessage || '')).slice(0, 500),
    ];

    sheet.appendRow(row);
  } catch (err) {
    logError('StorageService', 'Failed to write execution history to Runs sheet.', err);
  }
}

/**
 * Pure helper that partitions sheet data rows into kept vs pruned counts
 * based on a timestamp cutoff. Keeps rows with unparseable timestamps to avoid data loss.
 *
 * @param {Array<Array<*>>} rows
 * @param {number} primaryDateCol - 0-based column index
 * @param {number} fallbackDateCol - 0-based column index (-1 if none)
 * @param {number} cutoffMs - Epoch ms threshold
 * @returns {{ kept: Array<Array<*>>, removedCount: number }}
 */
function filterRowsByRetention_(rows, primaryDateCol, fallbackDateCol, cutoffMs) {
  const kept = [];
  let removedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const primaryRaw = row[primaryDateCol];
    let tsMs = primaryRaw ? new Date(primaryRaw).getTime() : NaN;

    if (isNaN(tsMs) && fallbackDateCol >= 0) {
      const fallbackRaw = row[fallbackDateCol];
      tsMs = fallbackRaw ? new Date(fallbackRaw).getTime() : NaN;
    }

    if (!isNaN(tsMs) && tsMs < cutoffMs) {
      removedCount++;
    } else {
      kept.push(row);
    }
  }

  return { kept: kept, removedCount: removedCount };
}

/**
 * Automatically prunes records older than `retentionDays` (default 7 days) from
 * SeenEmails, Stories, and Runs using fast batch rewrites.
 * NEVER touches the Sources tab or header rows.
 *
 * @param {number} [retentionDays]
 * @returns {{ retentionDays: number, removed: { SeenEmails: number, Stories: number, Runs: number }, totalRemoved: number }}
 */
function pruneOldSheetRecords(retentionDays) {
  const days = Math.max(1, Number(retentionDays) || SIGNALDESK_DEFAULTS.RETENTION_DAYS);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // Map each prunable tab to its primary & fallback date columns (0-based)
  const targets = [
    { name: SHEET_NAMES.SEEN_EMAILS, primaryCol: 4, fallbackCol: 3 }, // processed_at, received_at
    { name: SHEET_NAMES.STORIES, primaryCol: 8, fallbackCol: 7 },     // first_seen, story_date
    { name: SHEET_NAMES.RUNS, primaryCol: 1, fallbackCol: -1 },       // run_date
  ];

  const removed = { SeenEmails: 0, Stories: 0, Runs: 0 };
  let totalRemoved = 0;

  for (let t = 0; t < targets.length; t++) {
    const target = targets[t];
    const sheet = getRequiredSheet_(target.name);
    const lastRow = sheet.getLastRow();
    const numCols = SHEET_HEADERS[target.name].length;

    if (lastRow <= 1) continue;

    const dataRowCount = lastRow - 1;
    const dataRange = sheet.getRange(2, 1, dataRowCount, numCols);
    const rows = dataRange.getValues();

    const filtered = filterRowsByRetention_(rows, target.primaryCol, target.fallbackCol, cutoffMs);
    if (filtered.removedCount === 0) continue;

    // Clear old data rows and rewrite retained rows in one batch call
    dataRange.clearContent();
    if (filtered.kept.length > 0) {
      sheet.getRange(2, 1, filtered.kept.length, numCols).setValues(filtered.kept);
    }

    removed[target.name] = filtered.removedCount;
    totalRemoved += filtered.removedCount;
  }

  if (totalRemoved > 0) {
    logInfo(
      'StorageService',
      'Pruned ' + totalRemoved + ' row(s) older than ' + days + ' days from SignalDesk_DB.',
      removed
    );
  }

  return {
    retentionDays: days,
    removed: removed,
    totalRemoved: totalRemoved,
  };
}

