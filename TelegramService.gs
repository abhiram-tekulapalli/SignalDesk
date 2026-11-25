/**
 * SignalDesk — Telegram Bot API Delivery Service
 *
 * Delivers private HTML-formatted briefings and optional representative newsletter
 * images via the official Telegram Bot API (`sendMessage`, `sendPhoto`, `getMe`).
 * Never exposes bot credentials in logs or code.
 */

const TELEGRAM_API_ROOT_ = 'https://api.telegram.org/bot';

/**
 * Internal helper to call a Telegram Bot API method with rate-limit handling.
 * @param {string} method - e.g. 'sendMessage', 'sendPhoto', 'getMe'
 * @param {Object|null} payloadObj
 * @param {Object} config
 * @returns {{ ok: boolean, result: Object|null, errorCode: number, error: string }}
 */
function callTelegramApi_(method, payloadObj, config) {
  const cfg = config || getConfig();
  if (!cfg.telegramBotToken) {
    return {
      ok: false,
      result: null,
      errorCode: 0,
      error: 'TELEGRAM_BOT_TOKEN is not configured in Script Properties.',
    };
  }

  const endpoint = TELEGRAM_API_ROOT_ + cfg.telegramBotToken + '/' + method;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fetchOptions = {
        method: payloadObj ? 'post' : 'get',
        muteHttpExceptions: true,
      };

      if (payloadObj) {
        fetchOptions.contentType = 'application/json';
        fetchOptions.payload = JSON.stringify(payloadObj);
      }

      const response = UrlFetchApp.fetch(endpoint, fetchOptions);
      const httpCode = response.getResponseCode();
      const rawBody = response.getContentText('UTF-8') || '';

      let parsed = null;
      try {
        parsed = JSON.parse(rawBody);
      } catch (_) {
        parsed = null;
      }

      if (httpCode === 200 && parsed && parsed.ok) {
        return {
          ok: true,
          result: parsed.result || null,
          errorCode: 200,
          error: '',
        };
      }

      // Handle Telegram rate limit (HTTP 429)
      if (httpCode === 429 && attempt < maxAttempts) {
        const retryAfter =
          parsed && parsed.parameters && parsed.parameters.retry_after
            ? Number(parsed.parameters.retry_after)
            : 3;
        const sleepMs = Math.min(Math.max(retryAfter, 1), 15) * 1000;
        logWarn('TelegramService', 'Telegram rate limit hit; waiting ' + sleepMs + 'ms.');
        Utilities.sleep(sleepMs);
        continue;
      }

      const description =
        parsed && parsed.description
          ? parsed.description
          : 'HTTP ' + httpCode + ' from Telegram API';

      return {
        ok: false,
        result: null,
        errorCode: httpCode,
        error: redactSecrets(description),
      };
    } catch (err) {
      if (attempt < maxAttempts) {
        Utilities.sleep(1500);
        continue;
      }
      return {
        ok: false,
        result: null,
        errorCode: 0,
        error: serializeSafeError(err),
      };
    }
  }

  return {
    ok: false,
    result: null,
    errorCode: 0,
    error: 'Telegram API request exhausted retries.',
  };
}

/**
 * Sends a single HTML-formatted message to the configured private Telegram chat.
 *
 * @param {string} htmlText
 * @param {Object} [config]
 * @param {Object} [options] - { disableWebPagePreview: boolean, disableNotification: boolean }
 * @returns {{ ok: boolean, messageId: number|null, error: string }}
 */
function sendTelegramMessage(htmlText, config, options) {
  const cfg = config || getConfig();
  const opts = options || {};

  if (!cfg.telegramChatId) {
    return { ok: false, messageId: null, error: 'TELEGRAM_CHAT_ID is not configured.' };
  }

  let text = String(htmlText || '').trim();
  if (!text) {
    return { ok: false, messageId: null, error: 'Cannot send empty Telegram message.' };
  }
  if (text.length > 4096) {
    logWarn('TelegramService', 'Truncating oversized message chunk to Telegram 4,096-char ceiling.');
    text = text.slice(0, 4090) + '…';
  }

  const payload = {
    chat_id: cfg.telegramChatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: opts.disableWebPagePreview !== false,
    disable_notification: Boolean(opts.disableNotification),
  };

  const res = callTelegramApi_('sendMessage', payload, cfg);
  if (!res.ok) {
    logError('TelegramService', 'sendMessage failed: ' + res.error);
    return { ok: false, messageId: null, error: res.error };
  }

  return {
    ok: true,
    messageId: res.result && res.result.message_id ? res.result.message_id : null,
    error: '',
  };
}

/**
 * Sends a representative newsletter image with an HTML caption (<= 1,024 chars).
 * Designed to fail softly so the caller continues with full text delivery.
 *
 * @param {string} photoUrl - Must be HTTPS
 * @param {string} captionHtml
 * @param {Object} [config]
 * @returns {{ ok: boolean, messageId: number|null, error: string }}
 */
function sendTelegramPhoto(photoUrl, captionHtml, config) {
  const cfg = config || getConfig();

  if (!cfg.telegramChatId) {
    return { ok: false, messageId: null, error: 'TELEGRAM_CHAT_ID is not configured.' };
  }

  const cleanUrl = String(photoUrl || '').trim();
  if (!/^https:\/\//i.test(cleanUrl)) {
    return { ok: false, messageId: null, error: 'Photo URL must use HTTPS.' };
  }

  let caption = String(captionHtml || '').trim();
  if (caption.length > 1024) {
    caption = caption.slice(0, 1020) + '…';
  }

  const payload = {
    chat_id: cfg.telegramChatId,
    photo: cleanUrl,
    caption: caption,
    parse_mode: 'HTML',
  };

  const res = callTelegramApi_('sendPhoto', payload, cfg);
  if (!res.ok) {
    logWarn('TelegramService', 'sendPhoto failed (continuing with text digest): ' + res.error);
    return { ok: false, messageId: null, error: res.error };
  }

  return {
    ok: true,
    messageId: res.result && res.result.message_id ? res.result.message_id : null,
    error: '',
  };
}

/**
 * Delivers a complete formatted SignalDesk digest (optional hero image + all text chunks).
 *
 * @param {{ heroPhoto: {url: string, caption: string}|null, messages: string[] }} formattedDigest
 * @param {Object} [config]
 * @returns {{ ok: boolean, photoSent: boolean, messagesSent: number, messageIds: number[], error: string }}
 */
function deliverTelegramDigest(formattedDigest, config) {
  const cfg = config || getConfig();
  const messageIds = [];
  let photoSent = false;

  if (!formattedDigest || !Array.isArray(formattedDigest.messages) || formattedDigest.messages.length === 0) {
    return {
      ok: false,
      photoSent: false,
      messagesSent: 0,
      messageIds: [],
      error: 'Formatted digest contained zero messages to deliver.',
    };
  }

  // 1. Optional representative image (non-fatal if remote host blocks Telegram)
  if (formattedDigest.heroPhoto && formattedDigest.heroPhoto.url) {
    const photoRes = sendTelegramPhoto(
      formattedDigest.heroPhoto.url,
      formattedDigest.heroPhoto.caption,
      cfg
    );
    if (photoRes.ok) {
      photoSent = true;
      if (photoRes.messageId) messageIds.push(photoRes.messageId);
      Utilities.sleep(350);
    }
  }

  // 2. Ordered text message chunks
  for (let i = 0; i < formattedDigest.messages.length; i++) {
    const chunk = formattedDigest.messages[i];
    const msgRes = sendTelegramMessage(chunk, cfg, { disableWebPagePreview: true });
    if (!msgRes.ok) {
      return {
        ok: false,
        photoSent: photoSent,
        messagesSent: i,
        messageIds: messageIds,
        error: 'Failed sending digest chunk ' + (i + 1) + '/' + formattedDigest.messages.length + ': ' + msgRes.error,
      };
    }

    if (msgRes.messageId) {
      messageIds.push(msgRes.messageId);
    }

    if (i < formattedDigest.messages.length - 1) {
      Utilities.sleep(350);
    }
  }

  logInfo('TelegramService', 'Digest delivered successfully.', {
    photoSent: photoSent,
    messagesSent: formattedDigest.messages.length,
    messageIds: messageIds,
  });

  return {
    ok: true,
    photoSent: photoSent,
    messagesSent: formattedDigest.messages.length,
    messageIds: messageIds,
    error: '',
  };
}

/**
 * Verifies Telegram bot credentials via getMe and sends a private connection test message.
 * @returns {Object}
 */
function verifyTelegramConnection() {
  const cfg = getConfig();
  const meRes = callTelegramApi_('getMe', null, cfg);
  if (!meRes.ok) {
    logError('TelegramService', 'Bot verification (getMe) failed: ' + meRes.error);
    return { ok: false, botUsername: '', messageId: null, error: meRes.error };
  }

  const botUsername = (meRes.result && meRes.result.username) || 'unknown_bot';
  const testHtml = [
    '<b>SIGNALDESK — Connection Verified</b>',
    '',
    'Bot <code>@' + escapeTelegramHtml(botUsername) + '</code> is connected and ready to deliver your daily intelligence briefing.',
  ].join('\n');

  const sendRes = sendTelegramMessage(testHtml, cfg);
  const summary = {
    ok: sendRes.ok,
    botUsername: botUsername,
    messageId: sendRes.messageId,
    error: sendRes.error,
  };

  logInfo('TelegramService', 'Telegram connection check completed.', summary);
  return summary;
}
