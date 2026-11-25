/**
 * SignalDesk — Newsletter Content Cleaner & Batch Consolidator
 *
 * Strips footers, unsubscribe blocks, repeated navigation, promotional boilerplate,
 * and duplicate lines while preserving editorial headlines, summaries, links, and metadata.
 * Treats all newsletter content as untrusted data.
 *
 * Zero external API dependencies — designed for offline unit testing.
 */

/**
 * Neutralizes prompt-injection markers and control characters in untrusted text.
 * @param {string} text
 * @returns {string}
 */
function sanitizeUntrustedText(text) {
  if (!text) return '';
  let clean = String(text);

  // Strip null bytes and non-printable ASCII control chars except newline/tab
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Neutralize delimiter tags that could mimic our prompt envelope
  clean = clean.replace(/<\/?UNTRUSTED_NEWSLETTER[^>]*>/gi, '[escaped-tag]');
  clean = clean.replace(/<\/?SYSTEM_INSTRUCTION[^>]*>/gi, '[escaped-tag]');

  // Collapse excessive consecutive blank lines and decorative separator lines
  clean = clean.replace(/^[=\-*_~•·]{5,}$/gm, '');
  clean = clean.replace(/\n{3,}/g, '\n\n');

  return clean.trim();
}

/**
 * Checks whether a paragraph is pure footer / unsubscribe / email-chrome noise.
 * Carefully avoids dropping genuine editorial paragraphs that merely mention a product.
 *
 * @param {string} paragraph
 * @returns {boolean}
 */
function isFooterOrNavNoise_(paragraph) {
  const p = String(paragraph || '').trim();
  if (!p) return true;
  const lower = p.toLowerCase();

  // Hard footer/unsubscribe markers
  const hardNoisePatterns = [
    /you are receiving this email because/i,
    /you received this (?:email|message|newsletter) because/i,
    /click here to unsubscribe/i,
    /unsubscribe from (?:this list|all emails|these emails)/i,
    /update your (?:email )?preferences/i,
    /manage your (?:subscription|preferences)/i,
    /no longer wish to receive/i,
    /view this email in your browser/i,
    /having trouble viewing this email/i,
    /add us to your address book/i,
    /sent to [a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    /copyright\s*(?:©|\(c\))?\s*20\d{2}/i,
    /all rights reserved\.?$/i,
    /powered by (?:substack|beehiiv|convertkit|mailchimp|ghost|buttondown)/i,
    /want to advertise (?:with us|in this newsletter)/i,
    /interested in sponsoring/i,
    /forward this email to a friend/i,
    /refer a friend.*earn/i,
  ];

  for (let i = 0; i < hardNoisePatterns.length; i++) {
    if (hardNoisePatterns[i].test(p)) {
      // Only drop if it looks like boilerplate (< 320 chars) so we never wipe a long editorial block
      if (p.length < 320) return true;
    }
  }

  // Short navigation bars: "Sign Up | Advertise | View Online | Jobs"
  if (p.length < 140 && (p.match(/\|/g) || []).length >= 2) {
    if (/(?:sign up|advertise|view online|unsubscribe|archive|jobs|subscribe)/i.test(lower)) {
      return true;
    }
  }

  // Mailing address footer lines (e.g. "123 Market St, Suite 400, San Francisco, CA 94103")
  if (p.length < 140 && /\b(?:CA|NY|TX|DE|WA|MA)\s+\d{5}(?:-\d{4})?\b/.test(p)) {
    return true;
  }

  return false;
}

/**
 * Checks whether a short standalone header marks the start of an obvious sponsor ad block.
 * @param {string} paragraph
 * @returns {boolean}
 */
function isSponsorHeader_(paragraph) {
  const lower = String(paragraph || '').trim().toLowerCase();
  return /^(?:sponsored(?:\s+by)?|partnered?\s+with|together\s+with|presented\s+by|advertisement|from our sponsor)\b.{0,60}$/i.test(
    lower
  );
}

/**
 * Checks if a paragraph looks like a genuine editorial section header (ending any sponsor skip).
 * @param {string} paragraph
 * @returns {boolean}
 */
function isEditorialSectionBoundary_(paragraph) {
  const p = String(paragraph || '').trim();
  if (!p) return false;
  if (p.length <= 90 && /^(?:top stories|headlines|big tech|ai|science|programming|security|quick links|miscellaneous|deep dives|research|engineering|business|startups|news|launches)/i.test(p)) {
    return true;
  }
  return false;
}

/**
 * Cleans an extracted newsletter object into a compact, high-signal normalized record.
 *
 * @param {Object} extractedEmail - Output of extractEmailContent()
 * @param {number} [maxCharsPerNewsletter]
 * @returns {Object}
 */
function cleanNewsletterContent(extractedEmail, maxCharsPerNewsletter) {
  const maxChars = maxCharsPerNewsletter || SIGNALDESK_DEFAULTS.MAX_CHARS_PER_NEWSLETTER;
  const email = extractedEmail || {};

  const rawParagraphs =
    Array.isArray(email.paragraphs) && email.paragraphs.length > 0
      ? email.paragraphs
      : String(email.extractedText || email.rawPlain || '')
          .split(/\n+/)
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);

  const cleanedParagraphs = [];
  const seenNorm = {};
  let sponsorSkipRemaining = 0;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const para = sanitizeUntrustedText(rawParagraphs[i]);
    if (!para || para.length < 6) continue;

    // Stop sponsor skipping when a clear editorial section resumes
    if (sponsorSkipRemaining > 0 && isEditorialSectionBoundary_(para)) {
      sponsorSkipRemaining = 0;
    }

    // Skip only a tightly bounded sponsor snippet (max 2 short paragraphs) so editorial stories survive
    if (isSponsorHeader_(para)) {
      sponsorSkipRemaining = 2;
      continue;
    }

    if (sponsorSkipRemaining > 0) {
      sponsorSkipRemaining--;
      // Only skip if it actually reads like ad CTA copy; preserve long technical paragraphs
      if (para.length < 360 && /(?:try|book a demo|free trial|get started|learn more|sponsor|discount|promo|sign up free)/i.test(para)) {
        continue;
      }
      sponsorSkipRemaining = 0;
    }

    if (isFooterOrNavNoise_(para)) {
      continue;
    }

    // Deduplicate identical/repeated paragraphs within the same email
    const fingerprint = para.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (fingerprint.length < 4 || seenNorm[fingerprint]) continue;
    seenNorm[fingerprint] = true;

    cleanedParagraphs.push(para);
  }

  // Intelligently fit cleaned paragraphs within maxChars while preserving headlines & lead stories
  const selectedParagraphs = [];
  let charCount = 0;
  let wasTrimmed = false;

  for (let i = 0; i < cleanedParagraphs.length; i++) {
    const para = cleanedParagraphs[i];
    const addition = para.length + (selectedParagraphs.length > 0 ? 2 : 0);

    if (charCount + addition <= maxChars) {
      selectedParagraphs.push(para);
      charCount += addition;
    } else {
      const remaining = maxChars - charCount - 4;
      if (remaining >= 140) {
        // Trim gracefully at a sentence boundary
        const slice = para.slice(0, remaining);
        const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
        const cleanCut = lastPeriod > 80 ? slice.slice(0, lastPeriod + 1) : slice.trim() + '…';
        selectedParagraphs.push(cleanCut);
        charCount += cleanCut.length + 2;
      }
      wasTrimmed = true;
      break;
    }
  }

  const cleanedText = selectedParagraphs.join('\n\n');

  // Keep clean headlines & deduplicated editorial links
  const cleanHeadlines = (Array.isArray(email.headlines) ? email.headlines : [])
    .map(sanitizeUntrustedText)
    .filter(function (h) {
      return h.length >= 12 && !isFooterOrNavNoise_(h) && !isSponsorHeader_(h);
    })
    .slice(0, 20);

  const cleanLinks = (Array.isArray(email.links) ? email.links : [])
    .filter(function (l) {
      return l && l.url && /^https?:\/\//i.test(l.url);
    })
    .slice(0, 30);

  const cleanImages = (Array.isArray(email.images) ? email.images : [])
    .filter(function (img) {
      return img && img.url && /^https:\/\//i.test(img.url);
    })
    .slice(0, 3);

  // Editorial quality score for batch prioritization when limits are exceeded
  const editorialScore =
    Math.min(cleanedText.length / 200, 15) +
    Math.min(cleanHeadlines.length * 2, 16) +
    Math.min(cleanLinks.length, 12) +
    (cleanImages.length > 0 ? 2 : 0);

  return {
    messageId: email.messageId || '',
    senderEmail: email.senderEmail || '',
    publisher: sanitizeUntrustedText(email.publisher || 'Unknown Publisher'),
    categoryHint: sanitizeUntrustedText(email.categoryHint || ''),
    reliabilityNotes: sanitizeUntrustedText(email.reliabilityNotes || ''),
    subject: sanitizeUntrustedText(email.subject || ''),
    receivedAt: email.receivedAt || '',
    publicationDate: email.publicationDate || '',
    headlines: cleanHeadlines,
    cleanedText: cleanedText,
    links: cleanLinks,
    images: cleanImages,
    charCount: cleanedText.length,
    wasTrimmed: wasTrimmed,
    editorialScore: Math.round(editorialScore * 10) / 10,
    isEmpty: cleanedText.length < 80,
  };
}

/**
 * Consolidates cleaned newsletters into a single prioritized batch respecting
 * MAX_NEWSLETTERS and MAX_INPUT_CHARACTERS without silently dropping high-value stories.
 *
 * When the batch exceeds maxTotalChars, it allocates budget across all eligible
 * newsletters (prioritizing publisher diversity, recency, and editorial density)
 * rather than blindly dropping later newsletters.
 *
 * @param {Array<Object>} cleanedNewsletters
 * @param {number} [maxTotalChars]
 * @param {number} [maxNewsletters]
 * @returns {{ newsletters: Array<Object>, allowedUrls: string[], allowedImageUrls: string[], totalChars: number, droppedCount: number }}
 */
function consolidateNewsletterBatch(cleanedNewsletters, maxTotalChars, maxNewsletters) {
  const budgetTotal = maxTotalChars || SIGNALDESK_DEFAULTS.MAX_INPUT_CHARACTERS;
  const maxCount = maxNewsletters || SIGNALDESK_DEFAULTS.MAX_NEWSLETTERS;

  const nonEmpty = (cleanedNewsletters || []).filter(function (n) {
    return n && !n.isEmpty;
  });

  // Sort by editorial quality + recency so highest-signal newsletters get priority
  const ranked = nonEmpty.slice().sort(function (a, b) {
    const scoreDiff = (b.editorialScore || 0) - (a.editorialScore || 0);
    if (Math.abs(scoreDiff) > 3) return scoreDiff;
    return String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''));
  });

  // Enforce max newsletter count with publisher diversity preference
  const chosen = [];
  const publisherCounts = {};
  const overflow = [];

  for (let i = 0; i < ranked.length; i++) {
    const item = ranked[i];
    const pubKey = String(item.publisher || '').toLowerCase();
    const pubCount = publisherCounts[pubKey] || 0;

    if (chosen.length < maxCount && pubCount < 2) {
      chosen.push(item);
      publisherCounts[pubKey] = pubCount + 1;
    } else {
      overflow.push(item);
    }
  }

  for (let i = 0; i < overflow.length && chosen.length < maxCount; i++) {
    chosen.push(overflow[i]);
  }

  const droppedCount = Math.max(0, nonEmpty.length - chosen.length);

  // Compute proportional text budget if combined characters exceed budgetTotal
  const overheadPerItem = 650; // headers, link list, image metadata
  const totalTextChars = chosen.reduce(function (sum, n) {
    return sum + (n.cleanedText ? n.cleanedText.length : 0) + overheadPerItem;
  }, 0);

  const finalized = chosen.map(function (n) {
    if (totalTextChars <= budgetTotal) {
      return n;
    }
    const availableForText = Math.max(
      1200,
      Math.floor((budgetTotal - chosen.length * overheadPerItem) / chosen.length)
    );
    if (n.cleanedText.length <= availableForText) {
      return n;
    }
    const trimmed = n.cleanedText.slice(0, availableForText);
    const cut = trimmed.lastIndexOf('\n\n');
    const safeText = cut > availableForText * 0.5 ? trimmed.slice(0, cut) : trimmed.trim() + '…';
    return Object.assign({}, n, {
      cleanedText: safeText,
      charCount: safeText.length,
      wasTrimmed: true,
    });
  });

  // Build strict allowlists of all URLs and Image URLs present in the consolidated batch
  const allowedUrlSet = {};
  const allowedImageSet = {};
  let finalCharTotal = 0;

  for (let i = 0; i < finalized.length; i++) {
    const item = finalized[i];
    finalCharTotal += item.charCount || 0;

    const links = item.links || [];
    for (let j = 0; j < links.length; j++) {
      if (links[j] && links[j].url) {
        allowedUrlSet[links[j].url] = true;
      }
    }

    const images = item.images || [];
    for (let k = 0; k < images.length; k++) {
      if (images[k] && images[k].url) {
        allowedImageSet[images[k].url] = true;
      }
    }
  }

  return {
    newsletters: finalized,
    allowedUrls: Object.keys(allowedUrlSet),
    allowedImageUrls: Object.keys(allowedImageSet),
    totalChars: finalCharTotal,
    droppedCount: droppedCount,
  };
}
