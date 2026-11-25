/**
 * SignalDesk — Gmail MIME & Newsletter HTML Parser
 *
 * Extracts structured metadata, text, headlines, editorial article links,
 * and representative image URLs from raw Gmail API v1 message payloads.
 * Pure JS helpers allow offline unit testing without Gmail credentials.
 */

/**
 * Parses a "From" header like `"TLDR AI" <dan@tldrnewsletter.com>` into name & email.
 * @param {string} fromHeader
 * @returns {{ name: string, email: string }}
 */
function parseSenderHeader(fromHeader) {
  const raw = String(fromHeader || '').trim();
  if (!raw) return { name: '', email: '' };

  const angleMatch = raw.match(/^(?:"?([^"<]*?)"?\s*)?<([^>\s]+@[^>\s]+)>/);
  if (angleMatch) {
    return {
      name: String(angleMatch[1] || '').trim().replace(/^["']|["']$/g, ''),
      email: String(angleMatch[2] || '').trim().toLowerCase(),
    };
  }

  const bareMatch = raw.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (bareMatch) {
    return {
      name: '',
      email: bareMatch[1].toLowerCase(),
    };
  }

  return { name: raw, email: '' };
}

/**
 * Decodes Gmail API message body data into a UTF-8 string.
 *
 * IMPORTANT: Google Apps Script's Gmail Advanced Service (`Gmail.Users.Messages.get`)
 * returns `part.body.data` as a signed byte array (`number[]`), whereas raw Gmail REST
 * JSON returns a URL-safe base64 string. This function handles BOTH seamlessly.
 *
 * @param {string|number[]} encoded
 * @returns {string}
 */
function decodeGmailBase64(encoded) {
  if (!encoded) return '';

  // Case 1: Apps Script Gmail Advanced Service returns signed byte array (number[])
  if (Array.isArray(encoded)) {
    if (encoded.length === 0) return '';
    try {
      if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
        return Utilities.newBlob(encoded).getDataAsString('UTF-8');
      }
    } catch (err) {
      logWarn('EmailParser', 'Utilities.newBlob failed on byte array; using JS UTF-8 fallback.', err);
    }

    // Pure-JS UTF-8 fallback for offline tests / non-GAS runtimes
    const unsigned = new Uint8Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
      unsigned[i] = encoded[i] & 0xff;
    }
    if (typeof TextDecoder === 'function') {
      return new TextDecoder('utf-8').decode(unsigned);
    }
    let str = '';
    for (let j = 0; j < unsigned.length; j++) {
      str += String.fromCharCode(unsigned[j]);
    }
    try {
      return decodeURIComponent(escape(str));
    } catch (_) {
      return str;
    }
  }

  // Case 2: Raw URL-safe or standard base64 string
  const cleaned = String(encoded).replace(/\s+/g, '');
  if (!cleaned) return '';

  try {
    if (typeof Utilities !== 'undefined' && Utilities.base64DecodeWebSafe) {
      const bytes = Utilities.base64DecodeWebSafe(cleaned);
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    }
  } catch (err) {
    // Fall through to standard base64 / fallback decoder
  }

  const normalized = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '==='.slice(0, padLen);

  try {
    if (typeof Utilities !== 'undefined' && Utilities.base64Decode) {
      const bytes = Utilities.base64Decode(padded);
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    }
  } catch (_) {
    // Ignore and try browser/JS atob
  }

  if (typeof atob === 'function') {
    const binary = atob(padded);
    try {
      return decodeURIComponent(escape(binary));
    } catch (_) {
      return binary;
    }
  }

  return '';
}

/**
 * Decodes common HTML entities (named & numeric) safely into plain text.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  const named = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&bull;': '•',
    '&middot;': '·',
    '&copy;': '©',
    '&zwnj;': '',
    '&zwj;': '',
    '&shy;': '',
  };

  let out = String(text).replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|bull|middot|copy|zwnj|zwj|shy);/gi,
    function (match) {
      const key = match.toLowerCase();
      return named[key] !== undefined ? named[key] : match;
    }
  );

  // Decimal numeric entities: &#8217;
  out = out.replace(/&#(\d+);/g, function (_, code) {
    const num = parseInt(code, 10);
    if (isNaN(num) || num <= 0 || num > 0x10ffff) return '';
    try {
      return String.fromCodePoint(num);
    } catch (_) {
      return '';
    }
  });

  // Hex numeric entities: &#x2019;
  out = out.replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
    const num = parseInt(hex, 16);
    if (isNaN(num) || num <= 0 || num > 0x10ffff) return '';
    try {
      return String.fromCodePoint(num);
    } catch (_) {
      return '';
    }
  });

  return out;
}

/**
 * Recursively walks a Gmail MIME payload tree to collect text/html and text/plain parts.
 * Supports inline body.data (byte array or base64 string) and body.attachmentId fallback.
 *
 * @param {Object} part
 * @param {{ htmlParts: string[], plainParts: string[] }} acc
 * @param {string} [messageId]
 */
function walkMimeParts_(part, acc, messageId) {
  if (!part) return;

  const mimeType = String(part.mimeType || '').toLowerCase();
  const isHtml = mimeType.indexOf('text/html') === 0;
  const isPlain = mimeType.indexOf('text/plain') === 0;

  let bodyData = part.body && part.body.data ? part.body.data : null;

  // Fallback for oversized text/html parts stored as attachment references
  if (
    !bodyData &&
    (isHtml || isPlain) &&
    part.body &&
    part.body.attachmentId &&
    messageId &&
    typeof Gmail !== 'undefined' &&
    Gmail.Users &&
    Gmail.Users.Messages &&
    Gmail.Users.Messages.Attachments
  ) {
    try {
      const att = Gmail.Users.Messages.Attachments.get('me', messageId, part.body.attachmentId);
      if (att && att.data) {
        bodyData = att.data;
      }
    } catch (err) {
      logWarn('EmailParser', 'Failed fetching oversized MIME part attachment for ' + messageId, err);
    }
  }

  if (isHtml && bodyData) {
    const decodedHtml = decodeGmailBase64(bodyData);
    if (decodedHtml) acc.htmlParts.push(decodedHtml);
  } else if (isPlain && bodyData) {
    const decodedPlain = decodeGmailBase64(bodyData);
    if (decodedPlain) acc.plainParts.push(decodedPlain);
  }

  if (Array.isArray(part.parts)) {
    for (let i = 0; i < part.parts.length; i++) {
      walkMimeParts_(part.parts[i], acc, messageId);
    }
  }
}

/**
 * Extracts structured email metadata, text, headlines, links, and images from a Gmail API message.
 *
 * @param {Object} rawMessage - Gmail API v1 Message resource (format: 'full')
 * @param {Object} [sourceMeta] - Approved source record from Sources tab
 * @returns {Object}
 */
function extractEmailContent(rawMessage, sourceMeta) {
  if (!rawMessage || !rawMessage.payload) {
    throw new Error('Invalid Gmail message payload.');
  }

  const headers = rawMessage.payload.headers || [];
  const fromHeader = getHeaderValue_(headers, 'From');
  const subject = decodeHtmlEntities(getHeaderValue_(headers, 'Subject') || '(No Subject)').trim();
  const dateHeader = getHeaderValue_(headers, 'Date');
  const sender = parseSenderHeader(fromHeader);

  const receivedMs = rawMessage.internalDate
    ? parseInt(rawMessage.internalDate, 10)
    : dateHeader
      ? new Date(dateHeader).getTime()
      : Date.now();
  const receivedDate = isNaN(receivedMs) ? new Date() : new Date(receivedMs);

  let pubDate = receivedDate;
  if (dateHeader) {
    const parsedHeaderDate = new Date(dateHeader);
    if (!isNaN(parsedHeaderDate.getTime())) {
      pubDate = parsedHeaderDate;
    }
  }

  const mimeAcc = { htmlParts: [], plainParts: [] };
  walkMimeParts_(rawMessage.payload, mimeAcc, String(rawMessage.id || ''));

  const rawHtml = mimeAcc.htmlParts.join('\n');
  const rawPlain = mimeAcc.plainParts.join('\n');

  const parsedHtml = rawHtml ? parseNewsletterHTML(rawHtml) : { headlines: [], paragraphs: [], text: '' };
  const articleLinks = extractArticleLinks(rawHtml, rawPlain);
  const relevantImages = extractRelevantImages(rawHtml);

  // Automatic plain-text fallback if HTML parsing produced sparse content while plain text exists
  const cleanPlainText = rawPlain
    ? rawPlain.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    : '';
  const usePlainFallback =
    parsedHtml.text.length < 150 && cleanPlainText.length > parsedHtml.text.length;

  const finalParagraphs = usePlainFallback
    ? cleanPlainText
        .split(/\n+/)
        .map(function (s) {
          return s.trim();
        })
        .filter(function (s) {
          return s.length >= 4;
        })
    : parsedHtml.paragraphs;

  const finalText = usePlainFallback ? cleanPlainText : parsedHtml.text;

  const publisher =
    (sourceMeta && sourceMeta.publisher) ||
    sender.name ||
    sender.email ||
    'Unknown Publisher';

  const timezone =
    typeof SIGNALDESK_DEFAULTS !== 'undefined' ? SIGNALDESK_DEFAULTS.TIMEZONE : 'Asia/Kolkata';

  return {
    messageId: String(rawMessage.id || ''),
    threadId: String(rawMessage.threadId || ''),
    senderEmail: sender.email,
    senderName: sender.name,
    publisher: publisher,
    categoryHint: (sourceMeta && sourceMeta.category) || '',
    reliabilityNotes: (sourceMeta && sourceMeta.reliabilityNotes) || '',
    subject: subject,
    receivedAt: receivedDate.toISOString(),
    publicationDate: formatDateInTimezone(pubDate, timezone, 'yyyy-MM-dd'),
    rawHtml: rawHtml,
    rawPlain: rawPlain,
    headlines: parsedHtml.headlines,
    paragraphs: finalParagraphs,
    extractedText: finalText,
    links: articleLinks,
    images: relevantImages,
  };
}

/**
 * Parses newsletter HTML into clean structural blocks: headlines, paragraphs, and readable text.
 * Strips scripts, styles, comments, and invisible preheader nodes first.
 *
 * @param {string} html
 * @returns {{ headlines: string[], paragraphs: string[], text: string }}
 */
function parseNewsletterHTML(html) {
  if (!html || typeof html !== 'string') {
    return { headlines: [], paragraphs: [], text: '' };
  }

  let working = html;

  // Remove non-content blocks completely
  working = working.replace(/<!--[\s\S]*?-->/g, ' ');
  working = working.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ');
  working = working.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  working = working.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  working = working.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  working = working.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');

  // Remove leaf hidden email preheader elements safely (never swallow nested body containers)
  working = working.replace(
    /<(div|span|p)\b[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|max-height\s*:\s*0(?:\s*px)?(?:\s*;|$)|opacity\s*:\s*0(?:\s*;|$))[^"']*["'][^>]*>[^<]{0,1200}<\/\1>/gi,
    ' '
  );

  // Extract headlines from h1-h4 and strong/b tags wrapping links
  const headlines = [];
  const headlineSet = {};

  const headingRegex = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let match;
  while ((match = headingRegex.exec(working)) !== null) {
    const cleanHeading = stripTagsToText_(match[1]);
    if (cleanHeading.length >= 12 && cleanHeading.length <= 220 && !isBoilerplateLine_(cleanHeading)) {
      const key = cleanHeading.toLowerCase();
      if (!headlineSet[key]) {
        headlineSet[key] = true;
        headlines.push(cleanHeading);
      }
    }
  }

  // Also capture newsletter-style bold anchor titles: <strong><a href="...">Headline</a></strong>
  const boldLinkRegex = /<(?:strong|b)\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/(?:strong|b)>/gi;
  while ((match = boldLinkRegex.exec(working)) !== null) {
    const cleanHeading = stripTagsToText_(match[1]);
    if (cleanHeading.length >= 18 && cleanHeading.length <= 200 && !isBoilerplateLine_(cleanHeading)) {
      const key = cleanHeading.toLowerCase();
      if (!headlineSet[key]) {
        headlineSet[key] = true;
        headlines.push(cleanHeading);
      }
    }
  }

  // Convert structural HTML tags into line breaks before stripping tags
  let structured = working;
  structured = structured.replace(/<br\s*\/?>/gi, '\n');
  structured = structured.replace(/<\/(p|div|tr|li|h[1-6]|section|article|blockquote|header|footer|table)>/gi, '\n');
  structured = structured.replace(/<li\b[^>]*>/gi, '\n• ');
  structured = structured.replace(/<hr\b[^>]*>/gi, '\n---\n');

  // Strip remaining HTML tags
  structured = structured.replace(/<[^>]+>/g, ' ');
  structured = decodeHtmlEntities(structured);

  // Normalize zero-width characters & whitespace
  structured = structured.replace(/[\u200B-\u200F\u202A-\u202E\u034F\uFEFF\u00AD]/g, '');
  structured = structured.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  structured = structured.replace(/[ \t]+/g, ' ');

  const rawLines = structured.split('\n');
  const paragraphs = [];
  const seenLine = {};

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line === '---' || line === '•') continue;
    if (line.length < 4) continue;
    const normKey = line.toLowerCase();
    if (seenLine[normKey]) continue;
    seenLine[normKey] = true;
    paragraphs.push(line);
  }

  return {
    headlines: headlines.slice(0, 30),
    paragraphs: paragraphs,
    text: paragraphs.join('\n\n'),
  };
}

/**
 * Strips tags and collapses spaces for a short HTML fragment.
 * @param {string} fragment
 * @returns {string}
 */
function stripTagsToText_(fragment) {
  return decodeHtmlEntities(String(fragment || '').replace(/<[^>]+>/g, ' '))
    .replace(/[\u200B-\u200F\u034F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a short heading/line is obvious newsletter UI chrome rather than editorial news.
 * @param {string} line
 * @returns {boolean}
 */
function isBoilerplateLine_(line) {
  const lower = String(line || '').trim().toLowerCase();
  return /^(?:view in browser|read online|unsubscribe|manage preferences|update preferences|privacy policy|terms of service|advertise with us|sign up|subscribe|share this|follow us|sponsored by|together with)$/i.test(
    lower
  );
}

/**
 * Extracts and cleans editorial article URLs from HTML anchors and plain-text fallback.
 * Filters out unsubscribe, tracking, social-profile, and non-HTTP links.
 *
 * @param {string} html
 * @param {string} [plainText]
 * @returns {Array<{ url: string, text: string }>}
 */
function extractArticleLinks(html, plainText) {
  const results = [];
  const seenUrl = {};

  const blockedUrlPatterns = [
    /unsubscribe/i,
    /opt[-_]?out/i,
    /manage[-_]?preferences/i,
    /email[-_]?preferences/i,
    /view[-_]?in[-_]?browser/i,
    /mailchi\.mp\/.*\/unsubscribe/i,
    /list-manage\.com\/unsubscribe/i,
    /list-manage\.com\/profile/i,
    /sendgrid\.net\/wf\/unsubscribe/i,
    /doubleclick\.net/i,
    /googleadservices\.com/i,
    /adsystem\.com/i,
    /facebook\.com\/sharer/i,
    /twitter\.com\/intent\//i,
    /linkedin\.com\/shareArticle/i,
    /mailto:/i,
    /javascript:/i,
    /^#/,
  ];

  const blockedAnchorPatterns = [
    /^(?:unsubscribe|manage preferences|update preferences|view in browser|read in browser|web version|privacy policy|terms|terms of service|contact us|advertise|sponsor|sign up|subscribe|forward|share|tweet|facebook|instagram|linkedin|youtube|tiktok)$/i,
  ];

  function tryAddLink(rawHref, anchorText) {
    const cleanedUrl = sanitizeAndUnwrapUrl_(rawHref);
    if (!cleanedUrl) return;

    for (let b = 0; b < blockedUrlPatterns.length; b++) {
      if (blockedUrlPatterns[b].test(cleanedUrl)) return;
    }

    const cleanAnchor = stripTagsToText_(anchorText || '');
    for (let a = 0; a < blockedAnchorPatterns.length; a++) {
      if (cleanAnchor && blockedAnchorPatterns[a].test(cleanAnchor)) return;
    }

    // Skip pure root social homepages without article path
    if (/^https?:\/\/(?:www\.)?(?:twitter|x|facebook|instagram|linkedin|youtube)\.com\/?$/i.test(cleanedUrl)) {
      return;
    }

    const dedupKey = cleanedUrl.toLowerCase();
    if (seenUrl[dedupKey]) {
      // Upgrade empty anchor text if a later occurrence has descriptive text
      if (!seenUrl[dedupKey].text && cleanAnchor) {
        seenUrl[dedupKey].text = cleanAnchor.slice(0, 180);
      }
      return;
    }

    const entry = {
      url: cleanedUrl,
      text: cleanAnchor.slice(0, 180),
    };
    seenUrl[dedupKey] = entry;
    results.push(entry);
  }

  // 1. Parse <a href="...">text</a> from HTML
  if (html && typeof html === 'string') {
    const anchorRegex = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRegex.exec(html)) !== null) {
      const href = decodeHtmlEntities(m[1] || m[2] || m[3] || '');
      const inner = m[4] || '';
      tryAddLink(href, inner);
    }
  }

  // 2. Fallback / supplement from plain-text URLs
  if (plainText && typeof plainText === 'string') {
    const plainUrlRegex = /https?:\/\/[^\s<>"{}|\\^`[\])]+/gi;
    let pm;
    while ((pm = plainUrlRegex.exec(plainText)) !== null) {
      const candidate = pm[0].replace(/[.,;:!?)]+$/, '');
      tryAddLink(candidate, '');
    }
  }

  return results.slice(0, 60);
}

/**
 * Validates HTTP(S) URLs, strips tracking parameters, and unwraps safe query-param redirects.
 * Never performs network requests.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeAndUnwrapUrl_(rawUrl) {
  if (!rawUrl) return '';
  let url = String(rawUrl).trim();
  if (!/^https?:\/\//i.test(url)) return '';

  // Reject unsafe control chars or spaces
  if (/[\s<>"]/.test(url)) {
    url = url.replace(/\s+/g, '');
  }

  // Safely unwrap common redirect query params like ?url=https%3A%2F%2F...
  const redirectParamMatch = url.match(/[?&](?:url|u|target|dest|destination|redirect)=(https?%3A%2F%2F[^&]+)/i);
  if (redirectParamMatch && redirectParamMatch[1]) {
    try {
      const unwrapped = decodeURIComponent(redirectParamMatch[1]);
      if (/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(unwrapped)) {
        url = unwrapped;
      }
    } catch (_) {
      // Keep original URL if decode fails
    }
  }

  // Strip common tracking query parameters without breaking functional query params
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex);
  }

  const qIndex = url.indexOf('?');
  if (qIndex !== -1) {
    const base = url.slice(0, qIndex);
    const queryStr = url.slice(qIndex + 1);
    const trackingParams = /^(?:utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid|mkt_tok|igshid|ref|ref_src|ref_url|source|src|s|ck_subscriber_id|_hsenc|_hsmi|vero_id|oly_anon_id|oly_enc_id|nr_email_referer)$/i;

    const kept = queryStr
      .split('&')
      .filter(function (pair) {
        if (!pair) return false;
        const key = pair.split('=')[0];
        return !trackingParams.test(key);
      });

    url = kept.length > 0 ? base + '?' + kept.join('&') : base;
  }

  if (url.length > 1000) return '';
  return url;
}

/**
 * Extracts representative editorial newsletter image URLs while aggressively excluding
 * tracking pixels, spacer GIFs, social icons, logos, and unsupported image formats.
 *
 * @param {string} html
 * @returns {Array<{ url: string, alt: string, score: number }>}
 */
function extractRelevantImages(html) {
  if (!html || typeof html !== 'string') return [];

  const imgRegex = /<img\b([^>]+)>/gi;
  const candidates = [];
  const seen = {};

  const blockedImagePatterns = [
    /pixel/i,
    /track/i,
    /open\.(?:gif|png)/i,
    /beacon/i,
    /spacer/i,
    /blank\.(?:gif|png)/i,
    /1x1/i,
    /logo/i,
    /avatar/i,
    /icon/i,
    /badge/i,
    /button/i,
    /social/i,
    /twitter|facebook|instagram|linkedin|youtube|substack-icon/i,
    /\.svg(?:\?|$)/i,
    /\.ico(?:\?|$)/i,
    /\.gif(?:\?|$)/i,
    /data:image/i,
    /list-manage\.com\/track/i,
    /mailchimp\.com\/.*\/open/i,
    /sendgrid\.net\/wf\/open/i,
    /convertkit/i,
    /beehiiv\.com\/.*\/open/i,
    /customeriomail/i,
    /awstrack\.me/i,
  ];

  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const attrs = match[1] || '';

    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    if (!srcMatch) continue;
    const rawSrc = decodeHtmlEntities(srcMatch[1] || srcMatch[2] || srcMatch[3] || '').trim();

    // Require HTTPS for reliable Telegram sendPhoto delivery
    if (!/^https:\/\//i.test(rawSrc)) continue;
    if (rawSrc.length > 800) continue;

    let blocked = false;
    for (let i = 0; i < blockedImagePatterns.length; i++) {
      if (blockedImagePatterns[i].test(rawSrc)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const widthMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
    const heightMatch = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
    const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;

    // Reject tiny images & tracking pixels explicitly sized in HTML
    if ((width > 0 && width < 180) || (height > 0 && height < 100)) {
      continue;
    }

    // Reject extreme banner strips (e.g. 600x20 decorative dividers)
    if (width > 0 && height > 0 && (width / height > 5 || height / width > 4)) {
      continue;
    }

    const altMatch = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const alt = decodeHtmlEntities((altMatch && (altMatch[1] || altMatch[2])) || '').trim();

    // Reject sponsor/logo alt text
    if (alt && /^(?:logo|icon|sponsor|advertisement|banner|spacer|pixel|subscribe|twitter|linkedin|facebook)$/i.test(alt)) {
      continue;
    }

    if (seen[rawSrc]) continue;
    seen[rawSrc] = true;

    // Score editorial suitability
    let score = 10;
    if (/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(rawSrc)) score += 10;
    if (width >= 300) score += 10;
    if (width >= 500) score += 5;
    if (height >= 200) score += 5;
    if (alt.length >= 15) score += 8;

    candidates.push({
      url: rawSrc,
      alt: alt.slice(0, 140),
      score: score,
    });
  }

  candidates.sort(function (a, b) {
    return b.score - a.score;
  });

  return candidates.slice(0, 5);
}
