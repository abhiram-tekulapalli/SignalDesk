/**
 * SignalDesk — Time-Driven Scheduler & Concurrency Lock Manager
 *
 * Installs daily Apps Script time-driven triggers in Asia/Kolkata:
 * 1. Morning Briefing (`runMorningDigest`) — defaults to ~7:00 AM IST (6:45–7:15 window)
 * 2. Night Recap (`runNightRecap`)         — defaults to ~9:30 PM IST (9:15–9:45 window, optional)
 *
 * Note: Google Apps Script triggers execute within an approximate ±15 minute window
 * of the target minute rather than at an exact second.
 */

const MANAGED_TRIGGER_HANDLERS_ = ['runDailyDigest', 'runMorningDigest', 'runNightRecap'];
const MORNING_TRIGGER_HANDLER_ = 'runMorningDigest';
const NIGHT_TRIGGER_HANDLER_ = 'runNightRecap';

/**
 * Snaps any minute value (0–59) to the nearest valid Apps Script nearMinute() value (0, 15, 30, 45).
 * @param {number} targetMinute
 * @returns {number}
 */
function snapToQuarterHour_(targetMinute) {
  const validMinutes = [0, 15, 30, 45];
  let snapped = 0;
  let bestDiff = 999;
  for (let i = 0; i < validMinutes.length; i++) {
    const diff = Math.abs(validMinutes[i] - targetMinute);
    if (diff < bestDiff) {
      bestDiff = diff;
      snapped = validMinutes[i];
    }
  }
  return snapped;
}

/**
 * Removes all existing SignalDesk daily/morning/night triggers to prevent duplicates.
 * @returns {number} Count of removed triggers
 */
function removeDailyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if (MANAGED_TRIGGER_HANDLERS_.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }

  logInfo('Scheduler', 'Removed ' + removed + ' existing SignalDesk trigger(s).');
  return removed;
}

/**
 * Installs SignalDesk's daily time-driven triggers:
 * - Morning briefing (~7:00–7:15 AM IST by default)
 * - Night recap (~9:30 PM IST by default, when ENABLE_NIGHT_RECAP is true)
 *
 * Automatically cleans up any pre-existing triggers first to prevent duplicates.
 *
 * @returns {{ timezone: string, morning: Object, night: Object|null }}
 */
function installDailyTrigger() {
  const cfg = getConfig();
  removeDailyTriggers();

  const tz = cfg.timezone || SIGNALDESK_DEFAULTS.TIMEZONE;

  // 1. Morning Briefing trigger
  const morningHour = typeof cfg.deliveryHour === 'number' ? cfg.deliveryHour : 7;
  const morningMin = snapToQuarterHour_(typeof cfg.deliveryMinute === 'number' ? cfg.deliveryMinute : 0);

  const morningTrigger = ScriptApp.newTrigger(MORNING_TRIGGER_HANDLER_)
    .timeBased()
    .everyDays(1)
    .atHour(morningHour)
    .nearMinute(morningMin)
    .inTimezone(tz)
    .create();

  const morningInfo = {
    triggerId: morningTrigger.getUniqueId(),
    handler: MORNING_TRIGGER_HANDLER_,
    targetHour: morningHour,
    targetMinute: morningMin,
  };

  // 2. Optional Night Recap trigger
  let nightInfo = null;
  if (cfg.enableNightRecap) {
    const nightHour = typeof cfg.nightDeliveryHour === 'number' ? cfg.nightDeliveryHour : 21;
    const nightMin = snapToQuarterHour_(
      typeof cfg.nightDeliveryMinute === 'number' ? cfg.nightDeliveryMinute : 30
    );

    const nightTrigger = ScriptApp.newTrigger(NIGHT_TRIGGER_HANDLER_)
      .timeBased()
      .everyDays(1)
      .atHour(nightHour)
      .nearMinute(nightMin)
      .inTimezone(tz)
      .create();

    nightInfo = {
      triggerId: nightTrigger.getUniqueId(),
      handler: NIGHT_TRIGGER_HANDLER_,
      targetHour: nightHour,
      targetMinute: nightMin,
    };
  }

  const summary = {
    timezone: tz,
    morning: morningInfo,
    night: nightInfo,
  };

  logInfo(
    'Scheduler',
    'Installed SignalDesk triggers — Morning ~' +
      String(morningHour).padStart(2, '0') +
      ':' +
      String(morningMin).padStart(2, '0') +
      (nightInfo
        ? ', Night Recap ~' +
          String(nightInfo.targetHour).padStart(2, '0') +
          ':' +
          String(nightInfo.targetMinute).padStart(2, '0')
        : ' (Night Recap disabled)') +
      ' (' +
      tz +
      ', ±15 min Apps Script window).',
    summary
  );

  return summary;
}

/**
 * Lists all triggers currently attached to this Apps Script project.
 * @returns {Array<{id: string, handler: string, eventType: string}>}
 */
function listSignalDeskTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const list = triggers.map(function (t) {
    return {
      id: t.getUniqueId(),
      handler: t.getHandlerFunction(),
      eventType: String(t.getEventType()),
    };
  });
  logInfo('Scheduler', 'Active project triggers: ' + list.length, list);
  return list;
}

/**
 * Executes a callback inside Apps Script's ScriptLock to prevent overlapping runs
 * (e.g., manual run colliding with scheduled trigger).
 *
 * @param {number} timeoutMs
 * @param {Function} callback
 * @returns {*}
 */
function withScriptLock(timeoutMs, callback) {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(timeoutMs || 10000);
  if (!acquired) {
    logWarn('Scheduler', 'Another SignalDesk execution holds ScriptLock. Skipping overlapping run.');
    return {
      skipped: true,
      reason: 'LOCK_CONTENTION',
    };
  }

  try {
    return callback();
  } finally {
    try {
      lock.releaseLock();
    } catch (err) {
      logWarn('Scheduler', 'Error releasing ScriptLock.', err);
    }
  }
}
