/**
 * SignalDesk — Configuration & Script Properties Management
 *
 * All credentials and runtime settings live in Apps Script Script Properties.
 * Never hardcode API keys, bot tokens, or chat IDs in source files.
 */

const SIGNALDESK_APP = {
  NAME: 'SignalDesk',
  TAGLINE: 'Your daily intelligence briefing.',
  DB_NAME: 'SignalDesk_DB',
  EXECUTION_BUDGET_MS: 300000, // 5 min soft ceiling inside Apps Script's 6 min hard limit
};

const SIGNALDESK_CATEGORIES = [
  'AI & Machine Learning',
  'Technology & Startups',
  'Programming & Developer Tools',
  'Science & Research',
  'Cybersecurity',
  'Interesting Discoveries & Internet Trends',
  'Business & Finance',
];

const SIGNALDESK_DEFAULTS = {
  // Configurable free-tier eligible Flash model (can be changed in Script Properties anytime)
  GEMINI_MODEL: 'gemini-4-hydrogen',
  SOURCE_LABEL: 'SignalDesk/Source',
  MAX_NEWSLETTERS: 12,
  MAX_CHARS_PER_NEWSLETTER: 4000,
  MAX_INPUT_CHARACTERS: 48000,
  MAX_OUTPUT_TOKENS: 8192,
  REQUEST_TIMEOUT: 60000, // Reference timeout in ms (UrlFetchApp enforces platform ~60s ceiling)
  TIMEZONE: 'Asia/Kolkata',
  DELIVERY_HOUR: 7, // Targets ~6:45–7:15 AM IST window (ready before 7:30 AM wake-up)
  DELIVERY_MINUTE: 0,
  ENABLE_NIGHT_RECAP: true, // Second daily shift for newsletters arriving during the day
  NIGHT_DELIVERY_HOUR: 21, // Targets ~9:15–9:45 PM IST window
  NIGHT_DELIVERY_MINUTE: 30,
  LOOKBACK_HOURS: 36, // Overlaps 24h to survive trigger jitter; SeenEmails prevents duplicates
  EMPTY_DAY_POLICY: 'NOTIFY', // Morning empty policy: 'NOTIFY' or 'SILENT'
  NIGHT_EMPTY_DAY_POLICY: 'SILENT', // Night empty policy: 'SILENT' avoids unnecessary late-night pings
  RETENTION_DAYS: 7, // Automatically clear SeenEmails, Stories, and Runs older than 7 days
  MIN_TOP_STORIES: 5,
  MAX_TOP_STORIES: 8,
  MAX_QUICK_BYTES: 5,
  DEDUP_LOOKBACK_DAYS: 4,
  DRY_RUN_MODE: false,
};

const REQUIRED_SCRIPT_PROPERTIES = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'SPREADSHEET_ID',
  'SOURCE_LABEL',
  'MAX_NEWSLETTERS',
  'MAX_INPUT_CHARACTERS',
  'TIMEZONE',
];

const SHEET_NAMES = {
  SOURCES: 'Sources',
  SEEN_EMAILS: 'SeenEmails',
  STORIES: 'Stories',
  RUNS: 'Runs',
};

const SHEET_HEADERS = {
  Sources: [
    'source_id',
    'publisher',
    'sender_email',
    'category',
    'reliability_notes',
    'enabled',
    'subscribed_at',
  ],
  SeenEmails: [
    'message_id',
    'sender',
    'subject',
    'received_at',
    'processed_at',
    'status',
    'run_id',
  ],
  Stories: [
    'story_id',
    'headline',
    'category',
    'summary',
    'importance',
    'source_urls',
    'publishers',
    'story_date',
    'first_seen',
    'duplicate_key',
    'run_id',
  ],
  Runs: [
    'run_id',
    'run_date',
    'emails_fetched',
    'emails_processed',
    'stories_detected',
    'stories_selected',
    'gemini_status',
    'telegram_status',
    'execution_time',
    'error_message',
  ],
};

/**
 * Reads a Script Property with an optional fallback value.
 * @param {string} key
 * @param {*} fallback
 * @returns {string}
 */
function getScriptProperty(key, fallback) {
  try {
    const props = PropertiesService.getScriptProperties();
    const value = props.getProperty(key);
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  } catch (err) {
    // Allow offline unit tests to run cleanly if PropertiesService is unavailable
  }
  return fallback !== undefined && fallback !== null ? String(fallback) : '';
}

/**
 * Saves a Script Property value.
 * @param {string} key
 * @param {string} value
 */
function setScriptProperty(key, value) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(key, String(value));
}

/**
 * Parses an integer Script Property with clamping and fallback.
 * @param {string} key
 * @param {number} defaultVal
 * @param {number} minVal
 * @param {number} maxVal
 * @returns {number}
 */
function getIntProperty_(key, defaultVal, minVal, maxVal) {
  const raw = getScriptProperty(key, '');
  if (!raw) return defaultVal;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(minVal, Math.min(maxVal, parsed));
}

/**
 * Parses a boolean Script Property.
 * @param {string} key
 * @param {boolean} defaultVal
 * @returns {boolean}
 */
function getBoolProperty_(key, defaultVal) {
  const raw = getScriptProperty(key, '').toLowerCase();
  if (!raw) return defaultVal;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Loads the complete runtime configuration from Script Properties + defaults.
 * @returns {Object}
 */
function getConfig() {
  const emptyDayRaw = getScriptProperty(
    'EMPTY_DAY_POLICY',
    SIGNALDESK_DEFAULTS.EMPTY_DAY_POLICY
  ).toUpperCase();
  const nightEmptyRaw = getScriptProperty(
    'NIGHT_EMPTY_DAY_POLICY',
    SIGNALDESK_DEFAULTS.NIGHT_EMPTY_DAY_POLICY
  ).toUpperCase();

  return {
    geminiApiKey: getScriptProperty('GEMINI_API_KEY', ''),
    geminiModel: getScriptProperty('GEMINI_MODEL', SIGNALDESK_DEFAULTS.GEMINI_MODEL),
    telegramBotToken: getScriptProperty('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: getScriptProperty('TELEGRAM_CHAT_ID', ''),
    spreadsheetId: getScriptProperty('SPREADSHEET_ID', ''),
    sourceLabel: getScriptProperty('SOURCE_LABEL', SIGNALDESK_DEFAULTS.SOURCE_LABEL),
    maxNewsletters: getIntProperty_('MAX_NEWSLETTERS', SIGNALDESK_DEFAULTS.MAX_NEWSLETTERS, 1, 50),
    maxCharsPerNewsletter: getIntProperty_(
      'MAX_CHARS_PER_NEWSLETTER',
      SIGNALDESK_DEFAULTS.MAX_CHARS_PER_NEWSLETTER,
      500,
      20000
    ),
    maxInputCharacters: getIntProperty_(
      'MAX_INPUT_CHARACTERS',
      SIGNALDESK_DEFAULTS.MAX_INPUT_CHARACTERS,
      4000,
      200000
    ),
    maxOutputTokens: getIntProperty_(
      'MAX_OUTPUT_TOKENS',
      SIGNALDESK_DEFAULTS.MAX_OUTPUT_TOKENS,
      1024,
      32768
    ),
    requestTimeout: getIntProperty_(
      'REQUEST_TIMEOUT',
      SIGNALDESK_DEFAULTS.REQUEST_TIMEOUT,
      5000,
      120000
    ),
    timezone: getScriptProperty('TIMEZONE', SIGNALDESK_DEFAULTS.TIMEZONE),
    deliveryHour: getIntProperty_('DELIVERY_HOUR', SIGNALDESK_DEFAULTS.DELIVERY_HOUR, 0, 23),
    deliveryMinute: getIntProperty_('DELIVERY_MINUTE', SIGNALDESK_DEFAULTS.DELIVERY_MINUTE, 0, 59),
    enableNightRecap: getBoolProperty_('ENABLE_NIGHT_RECAP', SIGNALDESK_DEFAULTS.ENABLE_NIGHT_RECAP),
    nightDeliveryHour: getIntProperty_(
      'NIGHT_DELIVERY_HOUR',
      SIGNALDESK_DEFAULTS.NIGHT_DELIVERY_HOUR,
      0,
      23
    ),
    nightDeliveryMinute: getIntProperty_(
      'NIGHT_DELIVERY_MINUTE',
      SIGNALDESK_DEFAULTS.NIGHT_DELIVERY_MINUTE,
      0,
      59
    ),
    lookbackHours: getIntProperty_('LOOKBACK_HOURS', SIGNALDESK_DEFAULTS.LOOKBACK_HOURS, 6, 168),
    retentionDays: getIntProperty_('RETENTION_DAYS', SIGNALDESK_DEFAULTS.RETENTION_DAYS, 1, 90),
    emptyDayPolicy: emptyDayRaw === 'SILENT' ? 'SILENT' : 'NOTIFY',
    nightEmptyDayPolicy: nightEmptyRaw === 'NOTIFY' ? 'NOTIFY' : 'SILENT',
    minTopStories: SIGNALDESK_DEFAULTS.MIN_TOP_STORIES,
    maxTopStories: SIGNALDESK_DEFAULTS.MAX_TOP_STORIES,
    maxQuickBytes: SIGNALDESK_DEFAULTS.MAX_QUICK_BYTES,
    dedupLookbackDays: SIGNALDESK_DEFAULTS.DEDUP_LOOKBACK_DAYS,
    dryRunMode: getBoolProperty_('DRY_RUN_MODE', SIGNALDESK_DEFAULTS.DRY_RUN_MODE),
    categories: SIGNALDESK_CATEGORIES.slice(),
  };
}

/**
 * Validates required configuration properties before execution.
 * @param {Object} config
 * @param {Object} [options] - { requireGemini, requireTelegram, requireSpreadsheet }
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateConfig(config, options) {
  const opts = options || {};
  const requireGemini = opts.requireGemini !== false;
  const requireTelegram = opts.requireTelegram !== false;
  const requireSpreadsheet = opts.requireSpreadsheet !== false;

  const missing = [];
  if (requireGemini && !config.geminiApiKey) missing.push('GEMINI_API_KEY');
  if (requireGemini && !config.geminiModel) missing.push('GEMINI_MODEL');
  if (requireTelegram && !config.telegramBotToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (requireTelegram && !config.telegramChatId) missing.push('TELEGRAM_CHAT_ID');
  if (requireSpreadsheet && !config.spreadsheetId) missing.push('SPREADSHEET_ID');
  if (!config.sourceLabel) missing.push('SOURCE_LABEL');
  if (!config.timezone) missing.push('TIMEZONE');

  return {
    valid: missing.length === 0,
    missing: missing,
  };
}

/**
 * Returns non-empty secret values so Logger can redact them before output.
 * @returns {string[]}
 */
function getSecretValues() {
  const keys = ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN'];
  const values = [];
  for (let i = 0; i < keys.length; i++) {
    const val = getScriptProperty(keys[i], '');
    if (val && val.length >= 6) {
      values.push(val);
    }
  }
  return values;
}

/**
 * Formats a Date in the configured timezone using Apps Script Utilities.
 * @param {Date} date
 * @param {string} timezone
 * @param {string} pattern
 * @returns {string}
 */
function formatDateInTimezone(date, timezone, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  const tz = timezone || SIGNALDESK_DEFAULTS.TIMEZONE;
  const fmt = pattern || 'yyyy-MM-dd';
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(d, tz, fmt);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Writes sensible default non-secret Script Properties if they are missing.
 * Does NOT overwrite existing values.
 */
function ensureDefaultScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperties();
  const updates = {};

  const defaultsToSeed = {
    GEMINI_MODEL: SIGNALDESK_DEFAULTS.GEMINI_MODEL,
    SOURCE_LABEL: SIGNALDESK_DEFAULTS.SOURCE_LABEL,
    MAX_NEWSLETTERS: String(SIGNALDESK_DEFAULTS.MAX_NEWSLETTERS),
    MAX_CHARS_PER_NEWSLETTER: String(SIGNALDESK_DEFAULTS.MAX_CHARS_PER_NEWSLETTER),
    MAX_INPUT_CHARACTERS: String(SIGNALDESK_DEFAULTS.MAX_INPUT_CHARACTERS),
    MAX_OUTPUT_TOKENS: String(SIGNALDESK_DEFAULTS.MAX_OUTPUT_TOKENS),
    REQUEST_TIMEOUT: String(SIGNALDESK_DEFAULTS.REQUEST_TIMEOUT),
    TIMEZONE: SIGNALDESK_DEFAULTS.TIMEZONE,
    DELIVERY_HOUR: String(SIGNALDESK_DEFAULTS.DELIVERY_HOUR),
    DELIVERY_MINUTE: String(SIGNALDESK_DEFAULTS.DELIVERY_MINUTE),
    ENABLE_NIGHT_RECAP: String(SIGNALDESK_DEFAULTS.ENABLE_NIGHT_RECAP),
    NIGHT_DELIVERY_HOUR: String(SIGNALDESK_DEFAULTS.NIGHT_DELIVERY_HOUR),
    NIGHT_DELIVERY_MINUTE: String(SIGNALDESK_DEFAULTS.NIGHT_DELIVERY_MINUTE),
    LOOKBACK_HOURS: String(SIGNALDESK_DEFAULTS.LOOKBACK_HOURS),
    RETENTION_DAYS: String(SIGNALDESK_DEFAULTS.RETENTION_DAYS),
    EMPTY_DAY_POLICY: SIGNALDESK_DEFAULTS.EMPTY_DAY_POLICY,
    NIGHT_EMPTY_DAY_POLICY: SIGNALDESK_DEFAULTS.NIGHT_EMPTY_DAY_POLICY,
  };

  Object.keys(defaultsToSeed).forEach(function (key) {
    if (!existing[key]) {
      updates[key] = defaultsToSeed[key];
    }
  });

  if (Object.keys(updates).length > 0) {
    props.setProperties(updates, false);
  }
}
