/**
 * SignalDesk — Editorial Ranking & Edition Curation
 *
 * Ranks deduplicated stories transparently using Gemini importance ratings,
 * multi-newsletter signal strength (capped), category diversity, and source quality.
 */

/**
 * Ranks stories from highest to lowest editorial priority.
 *
 * @param {Array<Object>} stories
 * @param {Object} [config]
 * @param {Object<string, string>} [sourceReliabilityMap] - Map of lowercase publisher -> reliability_notes
 * @returns {Array<Object>}
 */
function rankStories(stories, config, sourceReliabilityMap) {
  const input = Array.isArray(stories) ? stories : [];
  const cfg = config || getConfig();
  const relMap = sourceReliabilityMap || {};

  const scored = input.map(function (st, originalIndex) {
    const importance = Math.max(1, Math.min(5, Number(st.importance) || 3));
    const sources = Array.isArray(st.sources) ? st.sources : [];

    // Count distinct publishers covering this story
    const pubSet = {};
    let reliabilityBonus = 0;
    for (let i = 0; i < sources.length; i++) {
      const pub = String(sources[i].publisher || '').trim().toLowerCase();
      if (pub && !pubSet[pub]) {
        pubSet[pub] = true;
        const notes = String(relMap[pub] || '').toLowerCase();
        if (/(?:high|primary|trusted|tier.?1|authoritative|deep)/i.test(notes)) {
          reliabilityBonus = Math.max(reliabilityBonus, 0.35);
        }
      }
    }

    const uniquePublishers = Object.keys(pubSet).length;
    // Capped coverage bonus so widely syndicated fluff doesn't outrank a 5/5 technical breakthrough
    const coverageBonus = Math.min(Math.max(0, uniquePublishers - 1) * 0.4, 0.8);

    // Bonus for grounded source URLs & clear practical significance
    const hasGroundedUrl = sources.some(function (s) {
      return Boolean(s && s.url);
    });
    const groundingBonus = hasGroundedUrl ? 0.2 : 0;

    // Slight bonus if category is in the 7 configured core categories
    const inCoreCategories = (cfg.categories || SIGNALDESK_CATEGORIES).indexOf(st.category) !== -1;
    const categoryBonus = inCoreCategories ? 0.15 : 0;

    const compositeScore =
      Math.round((importance * 2.0 + coverageBonus + reliabilityBonus + groundingBonus + categoryBonus) * 100) /
      100;

    return Object.assign({}, st, {
      ranking_score: compositeScore,
      _originalIndex: originalIndex,
    });
  });

  scored.sort(function (a, b) {
    if (b.ranking_score !== a.ranking_score) {
      return b.ranking_score - a.ranking_score;
    }
    if (b.importance !== a.importance) {
      return b.importance - a.importance;
    }
    return a._originalIndex - b._originalIndex;
  });

  // Gentle diversity pass: avoid 4+ consecutive stories from the exact same category
  // while keeping the #1 top story strictly at position 0.
  const balanced = [];
  const remaining = scored.slice();
  const categoryCount = {};

  while (remaining.length > 0) {
    let pickIdx = 0;
    if (balanced.length >= 2) {
      const topCat = remaining[0].category;
      if ((categoryCount[topCat] || 0) >= 3) {
        // Look ahead for a strong story in an underrepresented category within 1.5 score points
        for (let k = 1; k < remaining.length; k++) {
          const alt = remaining[k];
          if (
            (categoryCount[alt.category] || 0) < 2 &&
            remaining[0].ranking_score - alt.ranking_score <= 1.5
          ) {
            pickIdx = k;
            break;
          }
        }
      }
    }

    const picked = remaining.splice(pickIdx, 1)[0];
    delete picked._originalIndex;
    categoryCount[picked.category] = (categoryCount[picked.category] || 0) + 1;
    balanced.push(picked);
  }

  return balanced;
}

/**
 * Selects the final 5–8 top stories and 3–5 quick bytes for the daily digest.
 * Moves overflow stories gracefully into quick_bytes when quick_bytes has room.
 *
 * @param {Array<Object>} rankedStories
 * @param {Array<Object>} quickBytes
 * @param {Object} [config]
 * @returns {{ topStories: Array<Object>, quickBytes: Array<Object> }}
 */
function selectDigestContent(rankedStories, quickBytes, config) {
  const cfg = config || getConfig();
  const maxTop = cfg.maxTopStories || SIGNALDESK_DEFAULTS.MAX_TOP_STORIES; // 8
  const maxQb = cfg.maxQuickBytes || SIGNALDESK_DEFAULTS.MAX_QUICK_BYTES; // 5

  const stories = Array.isArray(rankedStories) ? rankedStories : [];
  const topStories = stories.slice(0, maxTop);
  const overflow = stories.slice(maxTop);

  const finalQuickBytes = (Array.isArray(quickBytes) ? quickBytes : []).slice(0, maxQb);

  for (let i = 0; i < overflow.length && finalQuickBytes.length < maxQb; i++) {
    const ov = overflow[i];
    const firstSource = Array.isArray(ov.sources) && ov.sources.length > 0 ? ov.sources[0] : {};
    finalQuickBytes.push({
      headline: ov.headline,
      summary: ov.summary,
      category: ov.category,
      publisher: firstSource.publisher || '',
      url: firstSource.url || '',
    });
  }

  return {
    topStories: topStories,
    quickBytes: finalQuickBytes,
  };
}
