/**
 * SignalDesk — Structured Logging with Automatic Secret Redaction
 *
 * Ensures API keys, Telegram bot tokens, and sensitive email payloads
 * are never written to Apps Script logs or Google Sheets Runs logs.
 */

let SIGNALDESK_RUN_LOG_BUFFER_ = [];

/**
 * Resets the per-run in-memory log buffer.
 */
function resetRunLogs() {
  SIGNALDESK_RUN_LOG_BUFFER_ = [];
}

/**
 * Returns a copy of logs captured during the current run.
 * @returns {Array<Object>}
 */
function getRunLogs() {
  return SIGNALDESK_RUN_LOG_BUFFER_.slice();
}

/**
 * Redacts known secret values and URL credential patterns from any string.
 * @param {string} input
 * @returns {string}
 */
function redactSecrets(input) {
  if (input === null || input === undefined) return '';
  let text = String(input);

  // Redact Telegram bot URL tokens: /bot123456:ABC.../
  text = text.replace(/\/bot[0-9]{6,}:[A-Za-z0-9_-]{20,}/g, '/bot[REDACTED]');

  // Redact query-string API keys if any third-party error echoes a URL
  text = text.replace(/([?&](?:key|api_key|token|access_token)=)[^&\s"']+/gi, '$1[REDACTED]');

  // Redact Bearer / Google API key formats
  text = text.replace(/AIza[0-9A-Za-z_-]{30,}/g, '[REDACTED_API_KEY]');

  // Redact exact configured secret values from Script Properties
  const secrets = typeof getSecretValues === 'function' ? getSecretValues() : [];
  for (let i = 0; i < secrets.length; i++) {
    const secret = secrets[i];
    if (secret && text.indexOf(secret) !== -1) {
      text = text.split(secret).join('[REDACTED]');
    }
  }

  return text;
}

/**
 * Converts an Error or arbitrary object into a compact, secret-safe string.
 * @param {*} err
 * @returns {string}
 */
function serializeSafeError(err) {
  if (!err) return '';
  if (typeof err === 'string') return redactSecrets(err).slice(0, 600);
  if (err instanceof Error || (err && err.message)) {
    const name = err.name ? err.name + ': ' : '';
    return redactSecrets(name + err.message).slice(0, 600);
  }
  try {
    return redactSecrets(JSON.stringify(err)).slice(0, 600);
  } catch (_) {
    return redactSecrets(String(err)).slice(0, 600);
  }
}

/**
 * Internal log emitter.
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
 * @param {string} scope
 * @param {string} message
 * @param {*} [meta]
 */
function writeLog_(level, scope, message, meta) {
  const timestamp = new Date().toISOString();
  const safeMsg = redactSecrets(message);
  let safeMeta = '';

  if (meta !== undefined && meta !== null) {
    safeMeta = ' | ' + serializeSafeError(meta);
  }

  const line = '[' + timestamp + '] [' + level + '] [' + scope + '] ' + safeMsg + safeMeta;

  SIGNALDESK_RUN_LOG_BUFFER_.push({
    timestamp: timestamp,
    level: level,
    scope: scope,
    message: safeMsg,
  });

  if (SIGNALDESK_RUN_LOG_BUFFER_.length > 200) {
    SIGNALDESK_RUN_LOG_BUFFER_.shift();
  }

  if (typeof console !== 'undefined') {
    if (level === 'ERROR' && console.error) {
      console.error(line);
    } else if (level === 'WARN' && console.warn) {
      console.warn(line);
    } else if (console.log) {
      console.log(line);
    }
  } else if (typeof Logger !== 'undefined' && Logger.log) {
    Logger.log(line);
  }
}

function logDebug(scope, message, meta) {
  writeLog_('DEBUG', scope, message, meta);
}

function logInfo(scope, message, meta) {
  writeLog_('INFO', scope, message, meta);
}

function logWarn(scope, message, meta) {
  writeLog_('WARN', scope, message, meta);
}

function logError(scope, message, errorOrMeta) {
  writeLog_('ERROR', scope, message, errorOrMeta);
}
