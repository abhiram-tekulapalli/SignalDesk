/**
 * SignalDesk — Gmail API Advanced Service Integration (Read-Only)
 *
 * Uses the Gmail API Advanced Service (`Gmail.Users.Labels`, `Gmail.Users.Messages`)
 * with `gmail.readonly` scope. Never modifies, marks read, archives, or deletes emails.
 */

/**
 * Resolves a human-readable Gmail label name (e.g. "SignalDesk/Source")
 * to its internal Gmail label ID.
 *
 * @param {string} labelName
 * @returns {string|null}
 */
function resolveSourceLabelId(labelName) {
  if (typeof Gmail === 'undefined' || !Gmail.Users || !Gmail.Users.Labels) {
    throw new Error(
      'Gmail API Advanced Service is not enabled. In Apps Script editor: Services (+) -> Gmail API -> Add.'
    );
  }

  const target = String(labelName || '').trim().toLowerCase();
  if (!target) return null;

  const response = Gmail.Users.Labels.list('me');
  const labels = (response && response.labels) || [];

  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i];
    if (lbl && lbl.name && lbl.name.toLowerCase() === target) {
      return lbl.id;
    }
  }

  return null;
}

/**
 * Matches a parsed sender email address against the approved newsletter source list.
 * Supports exact email matches (recommended) and optional domain entries prefixed with "@".
 *
 * @param {string} senderEmail
 * @param {Array<Object>} approvedSources
 * @returns {Object|null}
 */
function matchApprovedSource(senderEmail, approvedSources) {
  const email = String(senderEmail || '').trim().toLowerCase();
  if (!email || !Array.isArray(approvedSources) || approvedSources.length === 0) {
    return null;
  }

  for (let i = 0; i < approvedSources.length; i++) {
    const src = approvedSources[i];
    if (!src || !src.enabled || !src.senderEmail) continue;
    const rule = src.senderEmail.trim().toLowerCase();

    // Exact match
    if (rule === email) {
      return src;
    }

    // Optional domain-level match if configured as "@example.com"
    if (rule.charAt(0) === '@' && email.endsWith(rule)) {
      return src;
    }
  }

  return null;
}

/**
 * Fetches unprocessed (and previously failed/recoverable) newsletters from Gmail.
 * Enforces BOTH the configured Gmail source label AND the approved Sources registry.
 *
 * @param {Object} config
 * @param {Array<Object>} approvedSources
 * @param {Object} seenEmailMap - Map of message_id -> SeenEmails record
 * @param {Object} [options] - { lookbackDaysOverride: number }
 * @returns {{ emails: Array<{rawMessage: Object, sourceMeta: Object, isRetry: boolean}>, skippedUnapproved: number, skippedAlreadyProcessed: number }}
 */
function fetchNewNewsletterEmails(config, approvedSources, seenEmailMap, options) {
  const cfg = config || getConfig();
  const opts = options || {};
  const sources = Array.isArray(approvedSources) ? approvedSources : [];
  const seenMap = seenEmailMap || {};

  if (sources.length === 0) {
    logWarn(
      'GmailService',
      'No enabled sources found in the Sources tab. Refusing to process unapproved inbox emails.'
    );
    return { emails: [], skippedUnapproved: 0, skippedAlreadyProcessed: 0 };
  }

  const labelId = resolveSourceLabelId(cfg.sourceLabel);
  if (!labelId) {
    throw new Error(
      'Gmail label "' +
        cfg.sourceLabel +
        '" was not found. Create this label in Gmail and apply a filter for your newsletters.'
    );
  }

  // Build lookback query capped safely at retentionDays so pruned 7+ day old emails are never re-processed
  const retentionCap = Math.max(1, cfg.retentionDays || SIGNALDESK_DEFAULTS.RETENTION_DAYS);
  const requestedDays =
    opts.lookbackDaysOverride && opts.lookbackDaysOverride > 0
      ? Math.round(opts.lookbackDaysOverride)
      : Math.max(1, Math.ceil((cfg.lookbackHours || 36) / 24));
  const lookbackDays = Math.min(requestedDays, retentionCap);
  const query = 'newer_than:' + lookbackDays + 'd';

  const candidateIds = [];
  const candidateIdSet = {};

  // 1. First queue any previously FAILED messages from SeenEmails for controlled recovery
  Object.keys(seenMap).forEach(function (msgId) {
    const rec = seenMap[msgId];
    if (rec && (rec.status === 'FAILED' || rec.status === 'RETRY')) {
      candidateIds.push({ id: msgId, isRetry: true });
      candidateIdSet[msgId] = true;
    }
  });

  // 2. Fetch recent messages carrying the SignalDesk/Source label
  let pageToken = null;
  const maxListFetch = Math.max(cfg.maxNewsletters * 4, 40);

  do {
    const listParams = {
      labelIds: [labelId],
      q: query,
      maxResults: Math.min(50, maxListFetch),
      includeSpamTrash: false,
    };
    if (pageToken) {
      listParams.pageToken = pageToken;
    }

    const listResp = Gmail.Users.Messages.list('me', listParams);
    const messages = (listResp && listResp.messages) || [];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m && m.id && !candidateIdSet[m.id]) {
        candidateIds.push({ id: m.id, isRetry: false });
        candidateIdSet[m.id] = true;
      }
    }

    pageToken = listResp && listResp.nextPageToken ? listResp.nextPageToken : null;
  } while (pageToken && candidateIds.length < maxListFetch);

  logInfo(
    'GmailService',
    'Found ' + candidateIds.length + ' candidate Gmail messages (including retries).'
  );

  const selected = [];
  let skippedUnapproved = 0;
  let skippedAlreadyProcessed = 0;

  for (let i = 0; i < candidateIds.length; i++) {
    if (selected.length >= cfg.maxNewsletters) {
      logInfo(
        'GmailService',
        'Reached MAX_NEWSLETTERS limit (' + cfg.maxNewsletters + '). Remaining messages will be picked up next run.'
      );
      break;
    }

    const item = candidateIds[i];
    const existing = seenMap[item.id];

    if (
      existing &&
      (existing.status === 'SUCCESS' || existing.status === 'SKIPPED_EMPTY')
    ) {
      skippedAlreadyProcessed++;
      continue;
    }

    try {
      // Lightweight metadata fetch first to verify sender before downloading full MIME payload
      const metaMsg = Gmail.Users.Messages.get('me', item.id, {
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const metaHeaders =
        (metaMsg && metaMsg.payload && metaMsg.payload.headers) || [];
      const fromHeader = getHeaderValue_(metaHeaders, 'From');
      const parsedSender = parseSenderHeader(fromHeader);
      const matchedSource = matchApprovedSource(parsedSender.email, sources);

      if (!matchedSource) {
        skippedUnapproved++;
        logDebug(
          'GmailService',
          'Skipping unapproved sender in source label: ' + parsedSender.email
        );
        continue;
      }

      // Download full MIME message only for approved, unprocessed newsletters
      const fullMessage = Gmail.Users.Messages.get('me', item.id, {
        format: 'full',
      });

      selected.push({
        rawMessage: fullMessage,
        sourceMeta: matchedSource,
        isRetry: item.isRetry,
      });
    } catch (err) {
      logWarn('GmailService', 'Failed to retrieve Gmail message ID ' + item.id, err);
    }
  }

  logInfo(
    'GmailService',
    'Selected ' +
      selected.length +
      ' newsletters (skipped already-processed: ' +
      skippedAlreadyProcessed +
      ', skipped unapproved: ' +
      skippedUnapproved +
      ').'
  );

  return {
    emails: selected,
    skippedUnapproved: skippedUnapproved,
    skippedAlreadyProcessed: skippedAlreadyProcessed,
  };
}

/**
 * Helper to extract a case-insensitive header value from Gmail API headers array.
 * @param {Array<{name: string, value: string}>} headers
 * @param {string} headerName
 * @returns {string}
 */
function getHeaderValue_(headers, headerName) {
  if (!Array.isArray(headers)) return '';
  const target = String(headerName || '').toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && String(headers[i].name || '').toLowerCase() === target) {
      return String(headers[i].value || '');
    }
  }
  return '';
}

/**
 * Verifies Gmail API Advanced Service connectivity, source label existence,
 * and approved newsletter visibility (read-only).
 * @returns {Object}
 */
function verifyGmailConnection() {
  const cfg = getConfig();
  const profile = Gmail.Users.getProfile('me');
  const labelId = resolveSourceLabelId(cfg.sourceLabel);

  let sampleCount = 0;
  if (labelId) {
    const listResp = Gmail.Users.Messages.list('me', {
      labelIds: [labelId],
      maxResults: 10,
      includeSpamTrash: false,
    });
    sampleCount = listResp && listResp.messages ? listResp.messages.length : 0;
  }

  const result = {
    ok: Boolean(profile && profile.emailAddress && labelId),
    emailAddress: profile ? profile.emailAddress : '',
    sourceLabel: cfg.sourceLabel,
    labelFound: Boolean(labelId),
    labelId: labelId || '',
    recentLabeledMessages: sampleCount,
  };

  logInfo('GmailService', 'Gmail connection check completed.', result);
  return result;
}
