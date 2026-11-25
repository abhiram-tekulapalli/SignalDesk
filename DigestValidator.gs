/**
 * SignalDesk — Structured Digest Validator & URL Ground-Truth Verifier
 *
 * Validates the JSON object returned by Gemini against the required SignalDesk schema
 * and enforces strict URL grounding so invented links or image URLs never reach Telegram.
 */

/**
 * Resolves a model-returned category string to one of the seven official categories.
 * @param {string} rawCategory
 * @param {string[]} allowedCategories
 * @returns {string}
 */
function normalizeCategory_(rawCategory, allowedCategories) {
  const cats = allowedCategories || SIGNALDESK_CATEGORIES;
  const input = String(rawCategory || '').trim().toLowerCase();

  for (let i = 0; i < cats.length; i++) {
    if (cats[i].toLowerCase() === input) {
      return cats[i];
    }
  }

  // Fuzzy keyword fallback into the 7 configured categories
  if (/(?:ai|artificial intelligence|machine learning|llm|ml|deep learning)/i.test(input)) {
    return 'AI & Machine Learning';
  }
  if (/(?:cyber|security|infosec|vulnerability|breach|malware)/i.test(input)) {
    return 'Cybersecurity';
  }
  if (/(?:program|dev|software|code|compiler|framework|open source|engineering)/i.test(input)) {
    return 'Programming & Developer Tools';
  }
  if (/(?:science|research|physics|biology|space|climate|medicine|health)/i.test(input)) {
    return 'Science & Research';
  }
  if (/(?:business|finance|market|economy|earnings|funding|venture|ipo)/i.test(input)) {
    return 'Business & Finance';
  }
  if (/(?:startup|tech|hardware|product|mobile|gadget|cloud)/i.test(input)) {
    return 'Technology & Startups';
  }

  return 'Interesting Discoveries & Internet Trends';
}

/**
 * Checks whether a candidate URL exists in the input URL allowlist
 * (comparing both exact string and normalized canonical URL).
 *
 * @param {string} url
 * @param {Object<string, string>} exactSet
 * @param {Object<string, string>} normalizedMap
 * @returns {string} The verified input URL, or empty string if ungrounded.
 */
function matchGroundedUrl_(url, exactSet, normalizedMap) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';

  if (exactSet[trimmed]) {
    return exactSet[trimmed];
  }

  const norm = typeof normalizeUrl === 'function' ? normalizeUrl(trimmed) : trimmed.toLowerCase();
  if (norm && normalizedMap[norm]) {
    return normalizedMap[norm];
  }

  return '';
}

/**
 * Validates and sanitizes Gemini's structured digest JSON.
 *
 * @param {Object} digest - Parsed JSON object from Gemini
 * @param {string[]} allowedInputUrls - Exact URLs extracted from the input newsletters
 * @param {string[]} [allowedImageUrls] - Exact image URLs extracted from the input newsletters
 * @param {Object} [config]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], sanitizedDigest: Object|null }}
 */
function validateDigest(digest, allowedInputUrls, allowedImageUrls, config) {
  const cfg = config || getConfig();
  const errors = [];
  const warnings = [];

  if (!digest || typeof digest !== 'object' || Array.isArray(digest)) {
    return {
      valid: false,
      errors: ['Digest root must be a JSON object.'],
      warnings: [],
      sanitizedDigest: null,
    };
  }

  // Build exact and normalized allowlists for zero-hallucination URL grounding
  const exactUrlSet = {};
  const normUrlMap = {};
  const urls = Array.isArray(allowedInputUrls) ? allowedInputUrls : [];
  for (let i = 0; i < urls.length; i++) {
    const u = String(urls[i] || '').trim();
    if (!u) continue;
    exactUrlSet[u] = u;
    const norm = typeof normalizeUrl === 'function' ? normalizeUrl(u) : u.toLowerCase();
    if (norm && !normUrlMap[norm]) {
      normUrlMap[norm] = u;
    }
  }

  const exactImgSet = {};
  const imgs = Array.isArray(allowedImageUrls) ? allowedImageUrls : [];
  for (let i = 0; i < imgs.length; i++) {
    const imgUrl = String(imgs[i] || '').trim();
    if (/^https:\/\//i.test(imgUrl)) {
      exactImgSet[imgUrl] = imgUrl;
    }
  }

  const enforceUrlAllowlist = urls.length > 0;
  const fallbackDate = formatDateInTimezone(new Date(), cfg.timezone, 'yyyy-MM-dd');

  const editionDate =
    typeof digest.edition_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(digest.edition_date.trim())
      ? digest.edition_date.trim()
      : fallbackDate;

  const greeting =
    typeof digest.greeting === 'string' && digest.greeting.trim()
      ? digest.greeting.trim().slice(0, 140)
      : 'Good morning!';

  const overview =
    typeof digest.overview === 'string' && digest.overview.trim()
      ? digest.overview.trim().slice(0, 500)
      : 'Here are the most relevant developments from your newsletters today.';

  // Validate stories array
  if (!Array.isArray(digest.stories)) {
    errors.push('Missing or invalid `stories` array.');
  }

  const sanitizedStories = [];
  const rawStories = Array.isArray(digest.stories) ? digest.stories : [];

  for (let i = 0; i < rawStories.length; i++) {
    const st = rawStories[i];
    if (!st || typeof st !== 'object') continue;

    const headline = String(st.headline || '').trim();
    const summary = String(st.summary || '').trim();
    const whyItMatters = String(st.why_it_matters || '').trim();

    if (!headline || !summary) {
      warnings.push('Dropped incomplete story at index ' + i + ' (missing headline or summary).');
      continue;
    }

    const category = normalizeCategory_(st.category, cfg.categories);
    const rawImportance = parseInt(st.importance, 10);
    const importance = isNaN(rawImportance) ? 3 : Math.max(1, Math.min(5, rawImportance));

    // Ground every source URL strictly against input newsletter URLs
    const rawSources = Array.isArray(st.sources) ? st.sources : [];
    const groundedSources = [];
    const seenSourceUrl = {};

    for (let j = 0; j < rawSources.length; j++) {
      const src = rawSources[j];
      if (!src || typeof src !== 'object') continue;

      const publisher = String(src.publisher || '').trim() || 'Newsletter Source';
      const pubDate =
        typeof src.publication_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.publication_date.trim())
          ? src.publication_date.trim()
          : editionDate;

      const rawUrl = String(src.url || '').trim();
      let verifiedUrl = '';
      if (rawUrl) {
        if (enforceUrlAllowlist) {
          verifiedUrl = matchGroundedUrl_(rawUrl, exactUrlSet, normUrlMap);
          if (!verifiedUrl) {
            warnings.push(
              'Stripped ungrounded URL from story "' + headline.slice(0, 50) + '": ' + rawUrl
            );
          }
        } else if (/^https?:\/\//i.test(rawUrl)) {
          verifiedUrl = rawUrl;
        }
      }

      const sourceDedupKey = (verifiedUrl || publisher).toLowerCase();
      if (seenSourceUrl[sourceDedupKey]) continue;
      seenSourceUrl[sourceDedupKey] = true;

      groundedSources.push({
        publisher: publisher.slice(0, 120),
        url: verifiedUrl,
        publication_date: pubDate,
      });
    }

    // Verify optional image URL strictly against extracted HTTPS newsletter images
    let verifiedImageUrl = '';
    if (st.image_url && typeof st.image_url === 'string') {
      const candidateImg = st.image_url.trim();
      if (exactImgSet[candidateImg]) {
        verifiedImageUrl = exactImgSet[candidateImg];
      } else if (candidateImg) {
        warnings.push('Stripped ungrounded image_url on story "' + headline.slice(0, 40) + '".');
      }
    }

    const eventDate =
      typeof st.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.event_date.trim())
        ? st.event_date.trim()
        : '';

    sanitizedStories.push({
      id: String(st.id || 'story_' + String(i + 1).padStart(3, '0')).trim(),
      headline: headline.slice(0, 220),
      category: category,
      summary: summary.slice(0, 800),
      why_it_matters: (whyItMatters || 'Worth tracking for its practical impact in this domain.').slice(0, 500),
      importance: importance,
      event_date: eventDate,
      image_url: verifiedImageUrl,
      sources: groundedSources,
      coverage_note: String(st.coverage_note || '').trim().slice(0, 160),
      humour: String(st.humour || '').trim().slice(0, 220),
    });
  }

  if (sanitizedStories.length === 0) {
    errors.push('Digest contains zero valid stories after validation.');
  }

  // Validate quick_bytes
  const sanitizedQuickBytes = [];
  const rawQuickBytes = Array.isArray(digest.quick_bytes) ? digest.quick_bytes : [];
  for (let i = 0; i < rawQuickBytes.length; i++) {
    const qb = rawQuickBytes[i];
    if (!qb) continue;

    if (typeof qb === 'string' && qb.trim()) {
      sanitizedQuickBytes.push({
        headline: '',
        summary: qb.trim().slice(0, 260),
        category: 'Interesting Discoveries & Internet Trends',
        publisher: '',
        url: '',
      });
      continue;
    }

    if (typeof qb === 'object') {
      const qbHeadline = String(qb.headline || '').trim();
      const qbSummary = String(qb.summary || '').trim();
      if (!qbHeadline && !qbSummary) continue;

      const rawQbUrl = String(qb.url || '').trim();
      const verifiedQbUrl = rawQbUrl
        ? enforceUrlAllowlist
          ? matchGroundedUrl_(rawQbUrl, exactUrlSet, normUrlMap)
          : /^https?:\/\//i.test(rawQbUrl)
            ? rawQbUrl
            : ''
        : '';

      if (rawQbUrl && !verifiedQbUrl) {
        warnings.push('Stripped ungrounded URL from quick_byte: ' + rawQbUrl);
      }

      sanitizedQuickBytes.push({
        headline: qbHeadline.slice(0, 160),
        summary: qbSummary.slice(0, 320),
        category: normalizeCategory_(qb.category, cfg.categories),
        publisher: String(qb.publisher || '').trim().slice(0, 100),
        url: verifiedQbUrl,
      });
    }
  }

  // Validate learning_topic
  const lt = digest.learning_topic && typeof digest.learning_topic === 'object' ? digest.learning_topic : {};
  const learningTopic = {
    title: String(lt.title || '').trim().slice(0, 160),
    explanation: String(lt.explanation || '').trim().slice(0, 700),
    example: String(lt.example || '').trim().slice(0, 500),
  };
  if (!learningTopic.title || !learningTopic.explanation) {
    warnings.push('learning_topic was incomplete; section may be omitted or shortened.');
  }

  // Validate rabbit_hole & ground every resource URL
  const rh = digest.rabbit_hole && typeof digest.rabbit_hole === 'object' ? digest.rabbit_hole : {};
  const rawResources = Array.isArray(rh.resources) ? rh.resources : [];
  const groundedResources = [];

  for (let i = 0; i < rawResources.length; i++) {
    const r = rawResources[i];
    if (!r) continue;
    const rawUrl = typeof r === 'string' ? r.trim() : String(r.url || '').trim();
    const verifiedUrl = rawUrl
      ? enforceUrlAllowlist
        ? matchGroundedUrl_(rawUrl, exactUrlSet, normUrlMap)
        : /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : ''
      : '';

    if (verifiedUrl) {
      groundedResources.push({
        title: typeof r === 'object' && r.title ? String(r.title).trim().slice(0, 140) : 'Source Link',
        publisher: typeof r === 'object' && r.publisher ? String(r.publisher).trim().slice(0, 100) : '',
        url: verifiedUrl,
      });
    } else if (rawUrl) {
      warnings.push('Stripped ungrounded URL from rabbit_hole.resources: ' + rawUrl);
    }
  }

  const rabbitHole = {
    title: String(rh.title || '').trim().slice(0, 160),
    description: String(rh.description || '').trim().slice(0, 600),
    resources: groundedResources,
  };

  const humourCorner = String(digest.humour_corner || '').trim().slice(0, 450);

  const dq = digest.daily_question && typeof digest.daily_question === 'object' ? digest.daily_question : {};
  const dailyQuestion = {
    question: String(dq.question || '').trim().slice(0, 300),
    answer: String(dq.answer || '').trim().slice(0, 350),
  };

  const sanitizedDigest = {
    edition_date: editionDate,
    greeting: greeting,
    overview: overview,
    stories: sanitizedStories,
    quick_bytes: sanitizedQuickBytes,
    learning_topic: learningTopic,
    rabbit_hole: rabbitHole,
    humour_corner: humourCorner,
    daily_question: dailyQuestion,
  };

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    sanitizedDigest: errors.length === 0 ? sanitizedDigest : null,
  };
}
