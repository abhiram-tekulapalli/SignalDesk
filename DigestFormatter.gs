/**
 * SignalDesk — Premium Editorial Telegram HTML Formatter & Message Splitter
 *
 * Formats the validated digest into a crisp 5–7 minute publication layout using
 * Telegram-safe HTML (`<b>`, `<i>`, `<a href="...">`, `<tg-spoiler>`).
 * Splits messages strictly on story/section boundaries under Telegram's 4,096-char limit
 * and enforces the 1,024-char photo caption limit.
 */

const TELEGRAM_MAX_MESSAGE_CHARS = 4000; // Safety buffer under Telegram's 4,096-char hard limit
const TELEGRAM_MAX_CAPTION_CHARS = 1000; // Safety buffer under Telegram's 1,024-char hard limit

/**
 * Escapes dynamic text for Telegram HTML parse mode.
 * @param {string} text
 * @returns {string}
 */
function escapeTelegramHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes a validated HTTP(S) URL for safe placement inside an HTML href attribute.
 * Returns empty string if the URL is not HTTP(S).
 *
 * @param {string} url
 * @returns {string}
 */
function escapeHtmlAttribute(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats an individual story block in clean editorial HTML.
 * @param {Object} story
 * @param {number} index - 1-based story number
 * @returns {string}
 */
function formatStoryBlock_(story, index) {
  const num = index < 10 ? '0' + index : String(index);
  const lines = [];

  lines.push('<b>' + num + '. ' + escapeTelegramHtml(story.headline) + '</b>');
  lines.push('<i>Category: ' + escapeTelegramHtml(story.category) + '</i>');
  lines.push('');
  lines.push('<b>What happened:</b> ' + escapeTelegramHtml(story.summary));
  lines.push('<b>Why it matters:</b> ' + escapeTelegramHtml(story.why_it_matters));

  if (story.humour) {
    lines.push('<i>Editorial aside: ' + escapeTelegramHtml(story.humour) + '</i>');
  }

  // Format clickable publisher source links
  const sources = Array.isArray(story.sources) ? story.sources : [];
  if (sources.length > 0) {
    const formattedSources = sources.map(function (src) {
      const pub = escapeTelegramHtml(src.publisher || 'Source');
      const safeHref = escapeHtmlAttribute(src.url);
      const pubDate = src.publication_date ? ' (' + escapeTelegramHtml(src.publication_date) + ')' : '';
      if (safeHref) {
        return '<a href="' + safeHref + '">' + pub + '</a>' + pubDate;
      }
      return pub + pubDate;
    });
    lines.push('<b>Source:</b> ' + formattedSources.join(' · '));
  }

  if (story.event_date) {
    lines.push('<i>Event date: ' + escapeTelegramHtml(story.event_date) + '</i>');
  }

  if (story.coverage_note) {
    lines.push('<i>Note: ' + escapeTelegramHtml(story.coverage_note) + '</i>');
  }

  return lines.join('\n');
}

/**
 * Packs logical HTML blocks into Telegram messages <= maxLength without
 * breaking stories, headlines, links, or HTML tags across message boundaries.
 *
 * @param {string[]} blocks
 * @param {number} [maxLength]
 * @returns {string[]}
 */
function splitTelegramMessages(blocks, maxLength) {
  const limit = maxLength || TELEGRAM_MAX_MESSAGE_CHARS;
  const messages = [];
  let current = '';

  for (let i = 0; i < blocks.length; i++) {
    const block = String(blocks[i] || '').trim();
    if (!block) continue;

    if (!current) {
      if (block.length <= limit) {
        current = block;
      } else {
        // Fallback: split an oversized single block on line boundaries only
        const subChunks = splitOversizedBlock_(block, limit);
        for (let s = 0; s < subChunks.length - 1; s++) {
          messages.push(subChunks[s]);
        }
        current = subChunks[subChunks.length - 1] || '';
      }
      continue;
    }

    const candidate = current + '\n\n' + block;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      messages.push(current);
      if (block.length <= limit) {
        current = block;
      } else {
        const subChunks = splitOversizedBlock_(block, limit);
        for (let s = 0; s < subChunks.length - 1; s++) {
          messages.push(subChunks[s]);
        }
        current = subChunks[subChunks.length - 1] || '';
      }
    }
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

/**
 * Splits a single block that exceeds Telegram's limit along newline boundaries
 * without cutting inside an HTML tag.
 *
 * @param {string} block
 * @param {number} limit
 * @returns {string[]}
 */
function splitOversizedBlock_(block, limit) {
  const lines = block.split('\n');
  const chunks = [];
  let buf = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = buf ? buf + '\n' + line : line;
    if (next.length <= limit) {
      buf = next;
    } else {
      if (buf) chunks.push(buf);
      buf = line.length <= limit ? line : line.slice(0, limit - 1) + '…';
    }
  }

  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Selects one representative HTTPS editorial image from the top stories
 * and formats a safe <= 1,024-character Telegram photo caption.
 *
 * @param {Object} digest
 * @returns {{ url: string, caption: string }|null}
 */
function selectHeroPhoto_(digest, editionType) {
  const isNight = String(editionType || 'MORNING').toUpperCase() === 'NIGHT';
  const stories = Array.isArray(digest.stories) ? digest.stories : [];
  let chosenStory = null;

  for (let i = 0; i < stories.length; i++) {
    const img = stories[i] && stories[i].image_url ? String(stories[i].image_url).trim() : '';
    if (/^https:\/\//i.test(img)) {
      chosenStory = stories[i];
      break;
    }
  }

  if (!chosenStory) return null;

  const captionLines = [
    '<b>SIGNALDESK</b>',
    isNight ? '<i>YOUR NIGHTLY INTELLIGENCE RECAP</i>' : '<i>YOUR DAILY INTELLIGENCE BRIEFING</i>',
    '',
    'Date: ' + escapeTelegramHtml(digest.edition_date),
    'Lead Visual: ' + escapeTelegramHtml(chosenStory.headline),
  ];

  let caption = captionLines.join('\n');
  if (caption.length > TELEGRAM_MAX_CAPTION_CHARS) {
    caption = caption.slice(0, TELEGRAM_MAX_CAPTION_CHARS - 1) + '…';
  }

  return {
    url: chosenStory.image_url,
    caption: caption,
  };
}

/**
 * Generates the complete formatted Telegram briefing payload (optional hero photo + ordered HTML chunks).
 *
 * @param {Object} digest - Validated, deduplicated, ranked digest object
 * @param {Object} [options] - { includePhoto: boolean, editionType: 'MORNING'|'NIGHT' }
 * @returns {{ heroPhoto: {url: string, caption: string}|null, messages: string[], totalChars: number }}
 */
function generateTelegramDigest(digest, options) {
  const opts = options || {};
  const includePhoto = opts.includePhoto !== false;
  const editionType = String(opts.editionType || 'MORNING').toUpperCase() === 'NIGHT' ? 'NIGHT' : 'MORNING';
  const isNight = editionType === 'NIGHT';
  const blocks = [];

  // Masthead
  const masthead = [
    '<b>SIGNALDESK</b>',
    isNight ? '<i>YOUR NIGHTLY INTELLIGENCE RECAP</i>' : '<i>YOUR DAILY INTELLIGENCE BRIEFING</i>',
    '',
    escapeTelegramHtml(digest.greeting || (isNight ? 'Good evening!' : 'Good morning!')),
    '',
    '<b>Date:</b> ' + escapeTelegramHtml(digest.edition_date),
    '<b>Estimated reading time:</b> ' + (isNight ? '4–6 minutes.' : '5–7 minutes.'),
    '',
    escapeTelegramHtml(digest.overview || ''),
  ].join('\n');
  blocks.push(masthead);

  // SECTION 01 — TOP STORIES
  const stories = Array.isArray(digest.stories) ? digest.stories : [];
  if (stories.length > 0) {
    blocks.push('━━━━━━━━━━━━━━━━━━━━\n<b>SECTION 01 — TOP STORIES</b>');
    for (let i = 0; i < stories.length; i++) {
      blocks.push(formatStoryBlock_(stories[i], i + 1));
    }
  }

  // SECTION 02 — QUICK BYTES
  const quickBytes = Array.isArray(digest.quick_bytes) ? digest.quick_bytes : [];
  if (quickBytes.length > 0) {
    const qbLines = ['━━━━━━━━━━━━━━━━━━━━', '<b>SECTION 02 — QUICK BYTES</b>', ''];
    for (let i = 0; i < quickBytes.length; i++) {
      const qb = quickBytes[i];
      const titlePart = qb.headline ? '<b>' + escapeTelegramHtml(qb.headline) + ':</b> ' : '';
      const summaryPart = escapeTelegramHtml(qb.summary || '');
      const safeHref = escapeHtmlAttribute(qb.url);
      const pubLabel = escapeTelegramHtml(qb.publisher || 'Read more');
      const linkPart = safeHref ? ' (<a href="' + safeHref + '">' + pubLabel + '</a>)' : qb.publisher ? ' (' + pubLabel + ')' : '';
      qbLines.push('• ' + titlePart + summaryPart + linkPart);
    }
    blocks.push(qbLines.join('\n'));
  }

  // SECTION 03 — ONE THING TO LEARN
  const lt = digest.learning_topic || {};
  if (lt.title && lt.explanation) {
    const learnLines = [
      '━━━━━━━━━━━━━━━━━━━━',
      '<b>SECTION 03 — ONE THING TO LEARN</b>',
      '',
      '<b>' + escapeTelegramHtml(lt.title) + '</b>',
      escapeTelegramHtml(lt.explanation),
    ];
    if (lt.example) {
      learnLines.push('');
      learnLines.push('<b>In practice:</b> ' + escapeTelegramHtml(lt.example));
    }
    blocks.push(learnLines.join('\n'));
  }

  // SECTION 04 — RABBIT HOLE OF THE DAY
  const rh = digest.rabbit_hole || {};
  if (rh.title && rh.description) {
    const rhLines = [
      '━━━━━━━━━━━━━━━━━━━━',
      '<b>SECTION 04 — RABBIT HOLE OF THE DAY</b>',
      '',
      '<b>' + escapeTelegramHtml(rh.title) + '</b>',
      escapeTelegramHtml(rh.description),
    ];
    const resources = Array.isArray(rh.resources) ? rh.resources : [];
    if (resources.length > 0) {
      rhLines.push('');
      rhLines.push('<b>Starting links:</b>');
      for (let i = 0; i < resources.length; i++) {
        const res = resources[i];
        const safeHref = escapeHtmlAttribute(res.url);
        if (!safeHref) continue;
        const label = escapeTelegramHtml(res.title || res.publisher || 'Explore');
        const pub = res.publisher ? ' — ' + escapeTelegramHtml(res.publisher) : '';
        rhLines.push('• <a href="' + safeHref + '">' + label + '</a>' + pub);
      }
    }
    blocks.push(rhLines.join('\n'));
  }

  // SECTION 05 — HUMOUR CORNER
  if (digest.humour_corner) {
    blocks.push(
      [
        '━━━━━━━━━━━━━━━━━━━━',
        '<b>SECTION 05 — HUMOUR CORNER</b>',
        '',
        escapeTelegramHtml(digest.humour_corner),
      ].join('\n')
    );
  }

  // SECTION 06 — QUICK KNOWLEDGE CHECK + SIGN-OFF
  const dq = digest.daily_question || {};
  const closingLines = [];
  if (dq.question) {
    closingLines.push('━━━━━━━━━━━━━━━━━━━━');
    closingLines.push('<b>SECTION 06 — QUICK KNOWLEDGE CHECK</b>');
    closingLines.push('');
    closingLines.push('<b>Q:</b> ' + escapeTelegramHtml(dq.question));
    if (dq.answer) {
      closingLines.push(
        '<b>A:</b> <tg-spoiler>' + escapeTelegramHtml(dq.answer) + '</tg-spoiler> <i>(tap to reveal)</i>'
      );
    }
    closingLines.push('');
  }
  closingLines.push('━━━━━━━━━━━━━━━━━━━━');
  closingLines.push(
    isNight
      ? "<i>That's your evening signal. Rest well and recharge!</i>"
      : "<i>That's your daily signal. Have a productive day!</i>"
  );
  blocks.push(closingLines.join('\n'));

  const messages = splitTelegramMessages(blocks, TELEGRAM_MAX_MESSAGE_CHARS);
  const heroPhoto = includePhoto ? selectHeroPhoto_(digest, editionType) : null;
  const totalChars = messages.reduce(function (acc, m) {
    return acc + m.length;
  }, 0);

  return {
    heroPhoto: heroPhoto,
    messages: messages,
    totalChars: totalChars,
  };
}

/**
 * Generates a concise empty-day Telegram message when no new approved newsletters arrived.
 * @param {string} editionDate
 * @param {'MORNING'|'NIGHT'} [editionType]
 * @returns {string}
 */
function generateEmptyDayMessage(editionDate, editionType) {
  const isNight = String(editionType || 'MORNING').toUpperCase() === 'NIGHT';
  return [
    '<b>SIGNALDESK</b>',
    isNight ? '<i>YOUR NIGHTLY INTELLIGENCE RECAP</i>' : '<i>YOUR DAILY INTELLIGENCE BRIEFING</i>',
    '',
    '<b>Date:</b> ' + escapeTelegramHtml(editionDate),
    '',
    isNight
      ? "No new newsletters arrived from your approved sources since this morning's briefing."
      : 'No new newsletters arrived from your approved sources since the last edition.',
    isNight
      ? 'Nothing new to catch up on — enjoy your evening.'
      : 'Nothing to scroll — enjoy the quiet morning.',
    '',
    isNight
      ? "<i>That's your evening signal. Rest well and recharge!</i>"
      : "<i>That's your daily signal. Have a productive day!</i>",
  ].join('\n');
}
