/**
 * SignalDesk — Story-Level Deduplication Engine
 *
 * Implements deterministic intra-edition and cross-day story deduplication using:
 * - Normalized canonical URLs
 * - Normalized headlines (stop-word filtered tokens)
 * - Main entity extraction
 * - Event description overlap
 * - Publication/event dates
 *
 * Designed so genuinely new developments about a previously covered entity
 * (e.g. a new Google or OpenAI release next week) are NEVER permanently suppressed.
 */

const DEDUP_STOP_WORDS_ = {
  a: 1, an: 1, the: 1, and: 1, or: 1, but: 1, in: 1, on: 1, at: 1, to: 1,
  for: 1, of: 1, with: 1, by: 1, from: 1, up: 1, about: 1, into: 1, over: 1,
  after: 1, is: 1, are: 1, was: 1, were: 1, be: 1, been: 1, being: 1, has: 1,
  have: 1, had: 1, its: 1, it: 1, this: 1, that: 1, these: 1, those: 1,
  as: 1, new: 1, latest: 1, announces: 1, announced: 1, launches: 1, launched: 1,
  releases: 1, released: 1, says: 1, report: 1, reports: 1, details: 1,
};

/**
 * Normalizes a URL into a canonical comparison string (lowercase host, no www,
 * no hash, no trailing slash, no tracking parameters).
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let s = url.trim();
  if (!/^https?:\/\//i.test(s)) return '';

  // Remove fragment
  const hashIdx = s.indexOf('#');
  if (hashIdx !== -1) s = s.slice(0, hashIdx);

  // Split protocol + host + path + query
  const match = s.match(/^https?:\/\/([^/?]+)(\/[^?]*)?(\?.*)?$/i);
  if (!match) return s.toLowerCase();

  let host = match[1].toLowerCase().replace(/^www\./, '');
  let path = (match[2] || '/').replace(/\/+$/, '') || '/';
  const rawQuery = match[3] ? match[3].slice(1) : '';

  const trackingPattern = /^(?:utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid|mkt_tok|ref|ref_src|source|src|s|igshid|_hsenc|_hsmi)$/i;
  let queryPart = '';
  if (rawQuery) {
    const kept = rawQuery
      .split('&')
      .filter(function (pair) {
        if (!pair) return false;
        const k = pair.split('=')[0];
        return !trackingPattern.test(k);
      })
      .sort();
    if (kept.length > 0) {
      queryPart = '?' + kept.join('&');
    }
  }

  return host + path + queryPart;
}

/**
 * Normalizes a headline into meaningful lowercase tokens.
 * @param {string} headline
 * @returns {{ text: string, tokens: string[] }}
 */
function normalizeHeadline(headline) {
  const cleaned = String(headline || '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = cleaned ? cleaned.split(' ') : [];
  const tokens = [];
  const seen = {};

  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i].replace(/^-+|-+$/g, '');
    if (t.length < 2 || DEDUP_STOP_WORDS_[t]) continue;
    if (!seen[t]) {
      seen[t] = true;
      tokens.push(t);
    }
  }

  return {
    text: tokens.join(' '),
    tokens: tokens,
  };
}

/**
 * Extracts main entities (proper nouns, acronyms, CVE IDs, versioned tech names)
 * from a headline + summary.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractMainEntities(text) {
  const input = String(text || '');
  if (!input) return [];

  const entitySet = {};
  const matches = input.match(
    /\b(?:CVE-\d{4}-\d{4,}|[A-Z]{2,}[0-9A-Za-z.-]*|[A-Z][a-z]+(?:\s+[A-Z][a-z0-9]+){0,2}|[A-Za-z]+[0-9]+(?:\.[0-9]+)*)\b/g
  );

  if (matches) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i].trim().toLowerCase();
      if (m.length >= 2 && !DEDUP_STOP_WORDS_[m]) {
        entitySet[m] = true;
      }
    }
  }

  return Object.keys(entitySet).slice(0, 15);
}

/**
 * Computes Jaccard similarity (0.0 to 1.0) between two token arrays.
 * @param {string[]} listA
 * @param {string[]} listB
 * @returns {number}
 */
function jaccardSimilarity_(listA, listB) {
  if (!listA || !listB || listA.length === 0 || listB.length === 0) return 0;
  const setA = {};
  let unionCount = 0;
  let intersectCount = 0;

  for (let i = 0; i < listA.length; i++) {
    if (!setA[listA[i]]) {
      setA[listA[i]] = true;
      unionCount++;
    }
  }

  const seenB = {};
  for (let j = 0; j < listB.length; j++) {
    const token = listB[j];
    if (seenB[token]) continue;
    seenB[token] = true;
    if (setA[token]) {
      intersectCount++;
    } else {
      unionCount++;
    }
  }

  return unionCount === 0 ? 0 : intersectCount / unionCount;
}

/**
 * Computes a deterministic, date-scoped duplicate fingerprint for Google Sheets storage.
 * Date scoping ensures a fresh announcement later in the month about the same company
 * gets a brand-new key.
 *
 * @param {Object} story
 * @returns {string}
 */
function computeDuplicateKey(story) {
  const st = story || {};
  const sources = Array.isArray(st.sources) ? st.sources : [];
  const firstUrl = sources.length > 0 && sources[0] && sources[0].url ? normalizeUrl(sources[0].url) : '';
  const storyDate =
    st.event_date ||
    (sources[0] && sources[0].publication_date) ||
    new Date().toISOString().slice(0, 10);

  if (firstUrl) {
    return 'url:' + firstUrl.slice(0, 160);
  }

  const normH = normalizeHeadline(st.headline || '');
  const topTokens = normH.tokens.slice(0, 6).sort().join('_');
  return 'evt:' + storyDate + ':' + (topTokens || 'untitled');
}

/**
 * Returns normalized URL set for a story object.
 * @param {Object} story
 * @returns {string[]}
 */
function getStoryNormalizedUrls_(story) {
  const urls = [];
  const seen = {};
  const sources = Array.isArray(story.sources) ? story.sources : [];
  for (let i = 0; i < sources.length; i++) {
    const n = normalizeUrl(sources[i] && sources[i].url);
    if (n && !seen[n]) {
      seen[n] = true;
      urls.push(n);
    }
  }
  return urls;
}

/**
 * Merges a duplicate story into a primary story, preserving all unique sources
 * and updating coverage notes without claiming independent verification.
 *
 * @param {Object} primary
 * @param {Object} duplicate
 * @returns {Object}
 */
function mergeDuplicateStories_(primary, duplicate) {
  const merged = Object.assign({}, primary);
  const combinedSources = (Array.isArray(primary.sources) ? primary.sources : []).slice();
  const seenSource = {};

  for (let i = 0; i < combinedSources.length; i++) {
    const key = (normalizeUrl(combinedSources[i].url) || combinedSources[i].publisher || '').toLowerCase();
    if (key) seenSource[key] = true;
  }

  const dupSources = Array.isArray(duplicate.sources) ? duplicate.sources : [];
  for (let j = 0; j < dupSources.length; j++) {
    const src = dupSources[j];
    const key = (normalizeUrl(src.url) || src.publisher || '').toLowerCase();
    if (key && !seenSource[key]) {
      seenSource[key] = true;
      combinedSources.push(src);
    }
  }

  merged.sources = combinedSources;
  merged.importance = Math.max(Number(primary.importance) || 3, Number(duplicate.importance) || 3);
  if (!merged.image_url && duplicate.image_url) {
    merged.image_url = duplicate.image_url;
  }

  // Count distinct publishers accurately
  const pubSet = {};
  for (let k = 0; k < combinedSources.length; k++) {
    const p = String(combinedSources[k].publisher || '').trim().toLowerCase();
    if (p) pubSet[p] = true;
  }
  const pubCount = Object.keys(pubSet).length;
  if (pubCount > 1) {
    merged.coverage_note =
      'Reported across ' + pubCount + ' newsletters (consolidated coverage; not independently verified).';
  }

  return merged;
}

/**
 * Checks whether two stories describe the same underlying event.
 * Requires either canonical URL overlap OR strong headline + event-summary/entity overlap.
 *
 * @param {Object} storyA
 * @param {Object} storyB
 * @param {boolean} isCrossDay
 * @returns {boolean}
 */
function areStoriesSameEvent_(storyA, storyB, isCrossDay) {
  // 1. Exact canonical URL match
  const urlsA = getStoryNormalizedUrls_(storyA);
  const urlsB = Array.isArray(storyB.sourceUrls)
    ? storyB.sourceUrls.map(normalizeUrl).filter(Boolean)
    : getStoryNormalizedUrls_(storyB);

  for (let i = 0; i < urlsA.length; i++) {
    if (urlsB.indexOf(urlsA[i]) !== -1) {
      return true;
    }
  }

  // 2. Headline & event description similarity
  const headA = normalizeHeadline(storyA.headline || '');
  const headB = normalizeHeadline(storyB.headline || '');
  const headlineSim = jaccardSimilarity_(headA.tokens, headB.tokens);

  const summaryA = normalizeHeadline(storyA.summary || '');
  const summaryB = normalizeHeadline(storyB.summary || '');
  const summarySim = jaccardSimilarity_(summaryA.tokens, summaryB.tokens);

  const entA = extractMainEntities((storyA.headline || '') + ' ' + (storyA.summary || ''));
  const entB = extractMainEntities((storyB.headline || '') + ' ' + (storyB.summary || ''));
  const entitySim = jaccardSimilarity_(entA, entB);

  if (isCrossDay) {
    // Stricter threshold across days so new developments about the same company are NOT suppressed
    if (headlineSim >= 0.65) return true;
    if (headlineSim >= 0.48 && summarySim >= 0.35 && entitySim >= 0.4) return true;
    return false;
  }

  // Intra-edition duplicate consolidation
  if (headlineSim >= 0.55) return true;
  if (headlineSim >= 0.38 && entitySim >= 0.45 && summarySim >= 0.25) return true;

  return false;
}

/**
 * Runs both intra-edition consolidation and cross-day historical duplicate suppression.
 *
 * @param {Array<Object>} stories - Validated stories from Gemini
 * @param {Array<Object>} [recentHistoricalStories] - Recent records from Stories tab
 * @returns {{ stories: Array<Object>, mergedIntraCount: number, suppressedHistoricalCount: number }}
 */
function deduplicateStories(stories, recentHistoricalStories) {
  const input = Array.isArray(stories) ? stories : [];
  const history = Array.isArray(recentHistoricalStories) ? recentHistoricalStories : [];

  // Stage 1: Consolidate any residual duplicates within the same edition
  const intraConsolidated = [];
  let mergedIntraCount = 0;

  for (let i = 0; i < input.length; i++) {
    const candidate = input[i];
    let mergedIntoExisting = false;

    for (let j = 0; j < intraConsolidated.length; j++) {
      if (areStoriesSameEvent_(candidate, intraConsolidated[j], false)) {
        intraConsolidated[j] = mergeDuplicateStories_(intraConsolidated[j], candidate);
        mergedIntraCount++;
        mergedIntoExisting = true;
        break;
      }
    }

    if (!mergedIntoExisting) {
      intraConsolidated.push(Object.assign({}, candidate));
    }
  }

  // Stage 2: Filter out exact repeats already delivered in recent days
  const freshStories = [];
  let suppressedHistoricalCount = 0;

  for (let i = 0; i < intraConsolidated.length; i++) {
    const st = intraConsolidated[i];
    const dupKey = computeDuplicateKey(st);
    st.duplicate_key = dupKey;

    let alreadyCovered = false;
    for (let h = 0; h < history.length; h++) {
      const hist = history[h];
      if ((hist.duplicateKey && hist.duplicateKey === dupKey) || areStoriesSameEvent_(st, hist, true)) {
        alreadyCovered = true;
        break;
      }
    }

    if (alreadyCovered) {
      suppressedHistoricalCount++;
      logInfo('Deduplication', 'Suppressed recently covered story: ' + st.headline);
    } else {
      freshStories.push(st);
    }
  }

  return {
    stories: freshStories,
    mergedIntraCount: mergedIntraCount,
    suppressedHistoricalCount: suppressedHistoricalCount,
  };
}
