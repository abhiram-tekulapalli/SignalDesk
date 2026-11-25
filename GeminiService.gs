/**
 * SignalDesk — Gemini Developer API Integration (UrlFetchApp)
 *
 * Executes ONE primary AI request per daily edition using an eligible
 * free-tier Flash model (configurable via GEMINI_MODEL Script Property).
 * Never enables paid Search Grounding or external paid APIs.
 *
 * Privacy notice: Gemini's free tier has separate data-use terms.
 * Only public newsletter content from approved publishers should be sent.
 */

const GEMINI_API_BASE_URL_ = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Builds the Gemini REST API request body.
 * Note: Gemini 4 models (`gemini-4-*`) do not accept deprecated sampling
 * parameters (`temperature`, `topP`, `topK`, `candidateCount`).
 *
 * @param {{ systemInstruction: string, userPrompt: string, responseSchema: Object }} promptBundle
 * @param {Object} config
 * @returns {Object}
 */
function buildGeminiRequestPayload_(promptBundle, config) {
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: promptBundle.responseSchema,
  };

  if (config.maxOutputTokens && config.maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = config.maxOutputTokens;
  }

  return {
    system_instruction: {
      parts: [{ text: promptBundle.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: promptBundle.userPrompt }],
      },
    ],
    generationConfig: generationConfig,
  };
}

/**
 * Calls the Gemini Developer API with HTTP status handling, rate-limit backoff,
 * and controlled retry (maximum 2 retries for transient 429/5xx or 1 retry for malformed JSON).
 *
 * @param {{ systemInstruction: string, userPrompt: string, responseSchema: Object }} promptBundle
 * @param {Object} [config]
 * @returns {{ ok: boolean, data: Object|null, status: string, attempts: number, usageMetadata: Object|null, error: string }}
 */
function processWithGemini(promptBundle, config) {
  const cfg = config || getConfig();
  if (!cfg.geminiApiKey) {
    return {
      ok: false,
      data: null,
      status: 'MISSING_API_KEY',
      attempts: 0,
      usageMetadata: null,
      error: 'GEMINI_API_KEY is not configured in Script Properties.',
    };
  }

  const modelName = encodeURIComponent(cfg.geminiModel || SIGNALDESK_DEFAULTS.GEMINI_MODEL);
  const endpoint = GEMINI_API_BASE_URL_ + modelName + ':generateContent';
  const payloadObj = buildGeminiRequestPayload_(promptBundle, cfg);
  const payloadJson = JSON.stringify(payloadObj);

  const maxAttempts = 3; // 1 primary + up to 2 controlled retries
  let lastError = '';
  let lastStatus = 'FAILED';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logInfo(
        'GeminiService',
        'Submitting digest request to model "' +
          cfg.geminiModel +
          '" (attempt ' +
          attempt +
          '/' +
          maxAttempts +
          ', promptChars=' +
          promptBundle.userPrompt.length +
          ').'
      );

      // Pass API key strictly in header (never query string) to avoid URL log leaks
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-goog-api-key': cfg.geminiApiKey,
        },
        payload: payloadJson,
        muteHttpExceptions: true,
      });

      const httpCode = response.getResponseCode();
      const responseText = response.getContentText('UTF-8') || '';

      if (httpCode === 200) {
        const parsed = parseGeminiResponse(responseText);
        if (parsed.ok) {
          logInfo('GeminiService', 'Gemini structured response parsed successfully.', {
            attempts: attempt,
            usageMetadata: parsed.usageMetadata,
          });
          return {
            ok: true,
            data: parsed.data,
            status: 'SUCCESS',
            attempts: attempt,
            usageMetadata: parsed.usageMetadata,
            error: '',
          };
        }

        // Malformed JSON or truncated response — permit at most 1 controlled retry
        lastStatus = 'INVALID_JSON';
        lastError = parsed.error || 'Malformed JSON returned by Gemini.';
        logWarn('GeminiService', 'Attempt ' + attempt + ' produced invalid JSON: ' + lastError);

        if (attempt < 2) {
          Utilities.sleep(2000);
          continue;
        }
        break;
      }

      // Handle HTTP 429 Rate Limit
      if (httpCode === 429) {
        lastStatus = 'RATE_LIMITED';
        lastError = extractGeminiApiError_(responseText, httpCode);
        logWarn('GeminiService', 'Rate limited (HTTP 429): ' + lastError);

        if (attempt < maxAttempts) {
          const headers = response.getAllHeaders ? response.getAllHeaders() : {};
          const retryAfterRaw = headers['Retry-After'] || headers['retry-after'] || '';
          const retryAfterSec = parseInt(retryAfterRaw, 10);
          const sleepMs =
            !isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 30
              ? retryAfterSec * 1000
              : Math.pow(2, attempt) * 2500 + Math.floor(Math.random() * 500);
          Utilities.sleep(sleepMs);
          continue;
        }
        break;
      }

      // Handle transient 5xx server errors
      if (httpCode >= 500 && httpCode < 600) {
        lastStatus = 'SERVER_ERROR_' + httpCode;
        lastError = extractGeminiApiError_(responseText, httpCode);
        logWarn('GeminiService', 'Transient Gemini server error (HTTP ' + httpCode + '): ' + lastError);

        if (attempt < maxAttempts) {
          Utilities.sleep(Math.pow(2, attempt) * 2000);
          continue;
        }
        break;
      }

      // Non-retryable 4xx (400 invalid payload, 401/403 invalid key, 404 invalid model)
      lastStatus = 'HTTP_' + httpCode;
      lastError = extractGeminiApiError_(responseText, httpCode);
      logError('GeminiService', 'Non-retryable Gemini API error (HTTP ' + httpCode + '): ' + lastError);
      break;
    } catch (err) {
      lastStatus = 'NETWORK_ERROR';
      lastError = serializeSafeError(err);
      logWarn('GeminiService', 'UrlFetchApp exception on attempt ' + attempt, err);
      if (attempt < maxAttempts) {
        Utilities.sleep(Math.pow(2, attempt) * 2000);
      }
    }
  }

  return {
    ok: false,
    data: null,
    status: lastStatus,
    attempts: maxAttempts,
    usageMetadata: null,
    error: redactSecrets(lastError || 'Gemini API request failed.'),
  };
}

/**
 * Parses the raw HTTP body returned by Gemini generateContent and extracts the JSON digest.
 *
 * @param {string} responseBody
 * @returns {{ ok: boolean, data: Object|null, rawText: string, usageMetadata: Object|null, error: string }}
 */
function parseGeminiResponse(responseBody) {
  if (!responseBody || typeof responseBody !== 'string') {
    return {
      ok: false,
      data: null,
      rawText: '',
      usageMetadata: null,
      error: 'Empty response body from Gemini API.',
    };
  }

  let envelope;
  try {
    envelope = JSON.parse(responseBody);
  } catch (err) {
    return {
      ok: false,
      data: null,
      rawText: '',
      usageMetadata: null,
      error: 'Gemini HTTP response was not valid JSON: ' + err.message,
    };
  }

  const usageMetadata = envelope.usageMetadata || null;

  if (envelope.promptFeedback && envelope.promptFeedback.blockReason) {
    return {
      ok: false,
      data: null,
      rawText: '',
      usageMetadata: usageMetadata,
      error: 'Prompt blocked by safety filter: ' + envelope.promptFeedback.blockReason,
    };
  }

  const candidate =
    Array.isArray(envelope.candidates) && envelope.candidates.length > 0
      ? envelope.candidates[0]
      : null;

  if (!candidate) {
    return {
      ok: false,
      data: null,
      rawText: '',
      usageMetadata: usageMetadata,
      error: 'Gemini returned zero candidates.',
    };
  }

  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    logWarn('GeminiService', 'Candidate finishReason was: ' + candidate.finishReason);
  }

  const parts = (candidate.content && candidate.content.parts) || [];
  const rawText = parts
    .map(function (p) {
      return p && typeof p.text === 'string' ? p.text : '';
    })
    .join('')
    .trim();

  if (!rawText) {
    return {
      ok: false,
      data: null,
      rawText: '',
      usageMetadata: usageMetadata,
      error: 'Gemini candidate contained no text output.',
    };
  }

  // Strip accidental markdown code fences if any model includes them
  let jsonCandidate = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Extract outermost JSON object boundaries if stray prose slipped in
  const firstBrace = jsonCandidate.indexOf('{');
  const lastBrace = jsonCandidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonCandidate = jsonCandidate.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsedData = JSON.parse(jsonCandidate);
    return {
      ok: true,
      data: parsedData,
      rawText: rawText,
      usageMetadata: usageMetadata,
      error: '',
    };
  } catch (parseErr) {
    return {
      ok: false,
      data: null,
      rawText: rawText.slice(0, 400),
      usageMetadata: usageMetadata,
      error:
        'Failed to parse Gemini JSON payload (finishReason=' +
        (candidate.finishReason || 'UNKNOWN') +
        '): ' +
        parseErr.message,
    };
  }
}

/**
 * Extracts a concise, secret-safe error message from a Gemini API error body.
 * @param {string} body
 * @param {number} httpCode
 * @returns {string}
 */
function extractGeminiApiError_(body, httpCode) {
  try {
    const parsed = JSON.parse(body);
    if (parsed && parsed.error) {
      return redactSecrets(
        'HTTP ' +
          httpCode +
          ' (' +
          (parsed.error.status || 'ERROR') +
          '): ' +
          (parsed.error.message || 'Unknown error')
      );
    }
  } catch (_) {
    // Fall back to truncated text
  }
  return redactSecrets('HTTP ' + httpCode + ': ' + String(body || '').slice(0, 240));
}

/**
 * Lightweight connectivity check against the configured Gemini model.
 * @returns {Object}
 */
function verifyGeminiConnection() {
  const cfg = getConfig();
  const promptBundle = {
    systemInstruction: 'Return valid JSON only.',
    userPrompt: 'Respond with status "ok" and a one-line greeting for SignalDesk.',
    responseSchema: {
      type: 'OBJECT',
      required: ['status', 'message'],
      properties: {
        status: { type: 'STRING' },
        message: { type: 'STRING' },
      },
    },
  };

  const result = processWithGemini(promptBundle, cfg);
  logInfo('GeminiService', 'Gemini connection check finished.', {
    ok: result.ok,
    model: cfg.geminiModel,
    status: result.status,
    error: result.error,
  });
  return result;
}
