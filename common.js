(function () {
  const ARTWORK_CACHE = new Map();
  const ARTWORK_IN_FLIGHT = new Map();
  const ARTWORK_STORAGE_KEY = "artworkCacheV3";
  const ARTWORK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const ARTWORK_NEGATIVE_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  const ARTWORK_MAX_CACHE_ENTRIES = 500;
  const ARTWORK_REQUEST_DELAY_MS = 3500;
  const EIGHTIES_API_URL = "https://www.80s80s.de/streams/api";
  const EIGHTIES_API_TTL_MS = 8000;

  let artworkQueueTail = Promise.resolve();
  let lastArtworkRequestAt = 0;
  let eightiesApiCache = { time: 0, entries: null };
  let eightiesApiInFlight = null;

  function sanitizeProvider(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "80s80s" || raw === "80s" || raw === "eighties") return "80s80s";
    return "on";
  }

  function providerInfo(provider) {
    const id = sanitizeProvider(provider);
    return (window.CMP_PROVIDERS && window.CMP_PROVIDERS[id]) ||
      (window.CMP_PROVIDERS && window.CMP_PROVIDERS.on) ||
      { id: "on", title: "ON Radio", shortTitle: "ON", defaultChannel: "0n-jukebox" };
  }

  function sanitizeSlug(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\/www\.0nradio\.com\/now_playing\//i, "")
      .replace(/^https?:\/\/streams\.80s80s\.de\//i, "")
      .replace(/\.json(?:\?.*)?$/i, "")
      .replace(/^\/+|\/+$/g, "")
      .split("/")[0]
      .replace(/[^a-z0-9-]/gi, "")
      .toLowerCase();
  }

  function unique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const clean = sanitizeSlug(value);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
    }
    return result;
  }

  function variantsForSlug(value) {
    const slug = sanitizeSlug(value);
    if (!slug) return [];
    const compact = slug.replace(/-/g, "");
    const variants = [slug, compact];
    if (!slug.startsWith("0n-") && slug.startsWith("0n")) {
      variants.push(`0n-${slug.slice(2)}`);
    }
    return unique(variants);
  }

  function titleSlug(value) {
    return fixTextEncoding(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function findChannel(value, provider = "on") {
    const id = sanitizeProvider(provider);
    const slug = sanitizeSlug(value);
    if (!slug) return null;

    const list = id === "80s80s"
      ? (window.EIGHTIES80S_CHANNELS || [])
      : (window.ON_CHANNELS || []);

    return list.find((channel) => {
      return (channel.slugs || [channel.slug]).some((candidate) => sanitizeSlug(candidate) === slug);
    }) || null;
  }

  function getCandidateSlugs(value, provider = "on") {
    const channel = findChannel(value, provider);
    if (channel) return unique(channel.slugs || [channel.slug]);
    return variantsForSlug(value);
  }

  const CP1252_REVERSE = {
    "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84,
    "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88,
    "\u2030": 0x89, "\u0160": 0x8A, "\u2039": 0x8B, "\u0152": 0x8C,
    "\u017D": 0x8E, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93,
    "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
    "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9A, "\u203A": 0x9B,
    "\u0153": 0x9C, "\u017E": 0x9E, "\u0178": 0x9F
  };

  const MOJIBAKE_RE = /(?:\u00c3.|\u00c2[\u0080-\u00bf\u00a0]|\u00e2\u20ac|\ufffd)/g;

  function decodeHtmlEntities(value) {
    const text = String(value || "");
    if (!/&(?:[a-z][a-z0-9]+|#[0-9]+|#x[0-9a-f]+);/i.test(text)) return text;
    if (typeof document === "undefined") return text;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }

  function suspiciousTextScore(value) {
    const text = String(value || "");
    const matches = text.match(MOJIBAKE_RE);
    return matches ? matches.length : 0;
  }

  function cp1252BytesFromString(value) {
    const bytes = [];
    for (const char of String(value || "")) {
      const code = char.charCodeAt(0);
      if (code <= 0xFF) {
        bytes.push(code);
      } else if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE, char)) {
        bytes.push(CP1252_REVERSE[char]);
      } else {
        return null;
      }
    }
    return new Uint8Array(bytes);
  }

  function repairMojibake(value) {
    let text = decodeHtmlEntities(value).replace(/\u00a0/g, " ").trim();
    for (let pass = 0; pass < 2; pass += 1) {
      const beforeScore = suspiciousTextScore(text);
      if (!beforeScore) break;

      const bytes = cp1252BytesFromString(text);
      if (!bytes) break;

      let candidate = text;
      try {
        candidate = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (_error) {
        break;
      }

      if (candidate && suspiciousTextScore(candidate) < beforeScore) {
        text = candidate;
      } else {
        break;
      }
    }
    return text;
  }

  function fixTextEncoding(value) {
    return repairMojibake(value);
  }

  function fixObjectTextEncoding(value) {
    if (typeof value === "string") return fixTextEncoding(value);
    if (Array.isArray(value)) return value.map((item) => fixObjectTextEncoding(item));
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = fixObjectTextEncoding(entry);
      }
      return result;
    }
    return value;
  }

  async function parseJsonResponse(response) {
    const buffer = await response.arrayBuffer();
    const utf8Text = new TextDecoder("utf-8").decode(buffer);

    if (utf8Text.includes("\uFFFD")) {
      try {
        return fixObjectTextEncoding(JSON.parse(new TextDecoder("windows-1252").decode(buffer)));
      } catch (_error) {
      }
    }

    try {
      return fixObjectTextEncoding(JSON.parse(utf8Text));
    } catch (utf8Error) {
      try {
        return fixObjectTextEncoding(JSON.parse(new TextDecoder("windows-1252").decode(buffer)));
      } catch (_error) {
        throw utf8Error;
      }
    }
  }

  function normalizeUrl(value) {
    let url = fixTextEncoding(value || "").trim();
    if (!url) return "";
    if (url.startsWith("//")) url = `https:${url}`;
    if (/^http:\/\/streams\.80s80s\.de\//i.test(url)) {
      url = url.replace(/^http:/i, "https:");
    }
    return url;
  }

  function firstPathSegment(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return "";
    try {
      const parsed = new URL(normalized);
      return sanitizeSlug(parsed.pathname.split("/").filter(Boolean)[0] || "");
    } catch (_error) {
      return sanitizeSlug(normalized);
    }
  }

  function display80s80sTitle(streamName) {
    const text = fixTextEncoding(streamName || "").replace(/\s+/g, " ").trim();
    if (!text) return "80s80s";
    if (/^80s80s\s+digital$/i.test(text)) return "80s80s RADIO";
    if (/^80s80s\s+nds$/i.test(text)) return "80s80s NIEDERSACHSEN";
    if (/^80s80s\s+mv$/i.test(text)) return "80s80s MECKLENBURG-VORPOMMERN";
    if (/^dark\s+wave$/i.test(text)) return "80s80s DARK WAVE";
    if (/^funk\s*&\s*soul$/i.test(text)) return "80s80s FUNK & SOUL";
    if (!/^80s80s\b/i.test(text)) return `80s80s ${text}`;
    return text;
  }

  function normalize80s80sEntry(raw, id) {
    const source = raw || {};
    const covers = source.covers || {};
    const high = normalizeUrl(source.url_high || source.urlHigh || "");
    const low = normalizeUrl(source.url_low || source.urlLow || "");
    const streamUrl = high || low;
    const streamName = fixTextEncoding(source.stream || "");
    const title = display80s80sTitle(streamName);
    const stationId = String(source.station_id || source.stationId || id || "").trim();
    const slugFromUrl = firstPathSegment(streamUrl);
    const slug = sanitizeSlug(slugFromUrl || stationId || titleSlug(title));
    const coverOriginalUrl = normalizeUrl(
      covers.cover_art_url_xxl ||
      covers.cover_art_url_xl ||
      covers.cover_art_url_l ||
      covers.cover_art_url_m ||
      covers.cover_art_url_s ||
      ""
    );
    const coverUrl = normalizeUrl(
      covers.cover_art_url_l ||
      covers.cover_art_url_xl ||
      covers.cover_art_url_m ||
      coverOriginalUrl ||
      ""
    );
    const streamLogoUrl = normalizeUrl(source.stream_logo || "");
    const titleVariant = titleSlug(title);
    const rawVariant = titleSlug(streamName);
    const slugs = unique([
      slug,
      stationId ? `station-${stationId}` : "",
      titleVariant,
      rawVariant,
      titleVariant.replace(/^80s80s-/, ""),
      rawVariant.replace(/^80s80s-/, "")
    ]);

    return {
      __provider: "80s80s",
      id: String(id || stationId || slug),
      provider: "80s80s",
      stationId,
      slug,
      slugs,
      title,
      stream: title,
      streamRaw: streamName,
      artist: fixTextEncoding(source.artist_name || source.artistName || ""),
      songTitle: fixTextEncoding(source.song_title || source.songTitle || ""),
      album: fixTextEncoding(source.collection_name || source.collectionName || source.album || ""),
      played: "",
      duration: "",
      coverUrl,
      coverOriginalUrl,
      streamLogoUrl,
      streamUrl,
      urlHigh: high,
      urlLow: low,
      raw: source
    };
  }

  function find80s80sEntry(entries, value) {
    if (!entries.length) return null;
    const slug = sanitizeSlug(value || "");
    const titleCandidate = titleSlug(value || "");

    return entries.find((entry) => {
      return (entry.slugs || []).some((candidate) => sanitizeSlug(candidate) === slug) ||
        sanitizeSlug(entry.slug) === slug ||
        sanitizeSlug(entry.stationId) === slug ||
        titleSlug(entry.title) === titleCandidate;
    }) || entries[0];
  }

  async function fetch80s80sApi(force = false) {
    const now = Date.now();
    if (!force && eightiesApiCache.entries && now - eightiesApiCache.time < EIGHTIES_API_TTL_MS) {
      return eightiesApiCache.entries;
    }
    if (!force && eightiesApiInFlight) return eightiesApiInFlight;

    eightiesApiInFlight = (async () => {
      const response = await fetch(`${EIGHTIES_API_URL}?_=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });
      if (!response.ok) throw new Error(`80s80s API HTTP ${response.status}`);

      const data = await parseJsonResponse(response);
      const entries = Object.entries(data || {})
        .map(([key, value]) => normalize80s80sEntry(value, key))
        .filter((entry) => entry.slug && entry.streamUrl);

      if (!entries.length) throw new Error("80s80s API liefert keine Programme.");
      window.EIGHTIES80S_CHANNELS = entries.map((entry) => ({
        provider: "80s80s",
        title: entry.title,
        slug: entry.slug,
        slugs: entry.slugs,
        stationId: entry.stationId,
        streamUrl: entry.streamUrl,
        streamLogoUrl: entry.streamLogoUrl
      }));
      eightiesApiCache = { time: Date.now(), entries };
      return entries;
    })().finally(() => {
      eightiesApiInFlight = null;
    });

    return eightiesApiInFlight;
  }

  async function fetchONNowPlaying(value) {
    const candidates = getCandidateSlugs(value, "on");
    if (!candidates.length) throw new Error("Kein Programm angegeben.");

    let lastError = null;
    for (const slug of candidates) {
      const url = `https://www.0nradio.com/now_playing/${slug}.json`;
      try {
        const requestUrl = `${url}?_=${Date.now()}`;
        const response = await fetch(requestUrl, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
          }
        });
        if (!response.ok) {
          lastError = new Error(`${slug}: HTTP ${response.status}`);
          continue;
        }
        const json = await parseJsonResponse(response);
        if (!json || !json.items || !json.items.current) {
          lastError = new Error(`${slug}: Keine Titeldaten.`);
          continue;
        }
        json.__provider = "on";
        return { slug, json, url, provider: "on" };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Now-Playing konnte nicht geladen werden.");
  }

  async function fetch80s80sNowPlaying(value) {
    const entries = await fetch80s80sApi(true);
    const entry = find80s80sEntry(entries, value);
    if (!entry) throw new Error("80s80s-Programm nicht gefunden.");
    return { slug: entry.slug, json: entry, url: EIGHTIES_API_URL, provider: "80s80s" };
  }

  async function fetchNowPlaying(value, providerOrOptions = "on") {
    const provider = sanitizeProvider(
      typeof providerOrOptions === "object" ? providerOrOptions.provider : providerOrOptions
    );
    if (provider === "80s80s") return fetch80s80sNowPlaying(value);
    return fetchONNowPlaying(value);
  }

  function get80s80sChannels(entries) {
    return (entries || []).map((entry) => ({
      provider: "80s80s",
      title: entry.title,
      slug: entry.slug,
      slugs: entry.slugs,
      stationId: entry.stationId,
      streamUrl: entry.streamUrl,
      streamLogoUrl: entry.streamLogoUrl
    }));
  }

  function getCurrentTrack(json) {
    if (json && json.__provider === "80s80s") {
      return {
        artist: fixTextEncoding(json.artist || ""),
        title: fixTextEncoding(json.songTitle || ""),
        played: fixTextEncoding(json.played || ""),
        duration: fixTextEncoding(json.duration || ""),
        album: fixTextEncoding(json.album || ""),
        coverUrl: normalizeUrl(json.coverUrl || ""),
        coverOriginalUrl: normalizeUrl(json.coverOriginalUrl || json.coverUrl || ""),
        streamLogoUrl: normalizeUrl(json.streamLogoUrl || ""),
        channelTitle: fixTextEncoding(json.title || json.stream || "80s80s"),
        streamUrl: normalizeUrl(json.streamUrl || "")
      };
    }

    const current = (json && json.items && json.items.current) || {};
    return {
      artist: fixTextEncoding(current.artist || ""),
      title: fixTextEncoding(current.title || ""),
      played: fixTextEncoding(current.played || ""),
      duration: fixTextEncoding(current.duration || ""),
      album: "",
      coverUrl: "",
      coverOriginalUrl: "",
      streamLogoUrl: "",
      channelTitle: "",
      streamUrl: ""
    };
  }

  function cleanForCompare(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/feat\.|ft\./g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function artworkLookupKey(artist, title) {
    return [artist, title]
      .map((value) => fixTextEncoding(value || "").toLowerCase())
      .join("\u0001");
  }

  function artworkUrlSize(url, size, quality) {
    const safeSize = Math.max(60, Math.min(Number(size) || 1000, 3000));
    const safeQuality = Math.max(1, Math.min(Number(quality) || 100, 999));
    return normalizeUrl(url || "").replace(
      /\/[^/]+\.(jpg|jpeg|png|webp)$/i,
      (_match, ext) => `/${safeSize}x${safeSize}-${safeQuality}.${ext}`
    );
  }

  function scoreArtworkResult(result, artist, title) {
    const wantedArtist = cleanForCompare(artist);
    const wantedTitle = cleanForCompare(title);
    const resultArtist = cleanForCompare(fixTextEncoding(result.artistName || ""));
    const resultTitle = cleanForCompare(fixTextEncoding(result.trackName || result.collectionName || ""));
    let score = 0;
    if (wantedArtist && resultArtist === wantedArtist) score += 4;
    else if (wantedArtist && (resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist))) score += 2;
    if (wantedTitle && resultTitle === wantedTitle) score += 5;
    else if (wantedTitle && (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle))) score += 3;
    if (result.wrapperType === "track") score += 1;
    return score;
  }

  function canUseStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function storageGet(defaults) {
    return new Promise((resolve) => {
      if (!canUseStorage()) {
        resolve(defaults || {});
        return;
      }
      try {
        chrome.storage.local.get(defaults || {}, (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(defaults || {});
            return;
          }
          resolve(items || defaults || {});
        });
      } catch (_error) {
        resolve(defaults || {});
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      if (!canUseStorage()) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set(values, () => resolve());
      } catch (_error) {
        resolve();
      }
    });
  }

  function pruneArtworkStore(store) {
    const entries = Object.entries(store || {});
    if (entries.length <= ARTWORK_MAX_CACHE_ENTRIES) return store || {};
    return Object.fromEntries(
      entries
        .sort((a, b) => Number((b[1] && b[1].time) || 0) - Number((a[1] && a[1].time) || 0))
        .slice(0, ARTWORK_MAX_CACHE_ENTRIES)
    );
  }

  async function getPersistentArtwork(key) {
    const items = await storageGet({ [ARTWORK_STORAGE_KEY]: {} });
    const store = items[ARTWORK_STORAGE_KEY] || {};
    const entry = store[key];
    if (!entry || !Object.prototype.hasOwnProperty.call(entry, "value")) {
      return { hit: false, value: null };
    }

    const age = Date.now() - Number(entry.time || 0);
    const ttl = entry.value ? ARTWORK_CACHE_TTL_MS : ARTWORK_NEGATIVE_CACHE_TTL_MS;
    if (age > ttl) {
      return { hit: false, value: null };
    }

    return { hit: true, value: entry.value || null };
  }

  async function savePersistentArtwork(key, value) {
    const items = await storageGet({ [ARTWORK_STORAGE_KEY]: {} });
    const store = pruneArtworkStore(items[ARTWORK_STORAGE_KEY] || {});
    store[key] = {
      time: Date.now(),
      value: value || null
    };
    await storageSet({ [ARTWORK_STORAGE_KEY]: pruneArtworkStore(store) });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function queueArtworkRequest(task) {
    const run = async () => {
      const elapsed = Date.now() - lastArtworkRequestAt;
      const waitMs = Math.max(0, ARTWORK_REQUEST_DELAY_MS - elapsed);
      if (waitMs > 0) await delay(waitMs);
      lastArtworkRequestAt = Date.now();
      return task();
    };

    const requestPromise = artworkQueueTail.then(run, run);
    artworkQueueTail = requestPromise.catch(() => {});
    return requestPromise;
  }

  function isArtworkRateLimitError(error) {
    const message = String((error && error.message) || error || "").toLowerCase();
    return message.includes("limit") || message.includes("http 429") || message.includes("http 403");
  }

  async function findArtwork(artist, title, options = {}) {
    const cleanArtist = fixTextEncoding(artist || "");
    const cleanTitle = fixTextEncoding(title || "");
    if (!cleanArtist && !cleanTitle) return null;

    const country = String(options.country || window.ON_DEFAULTS.country || "DE").toUpperCase();
    const size = Number(options.size || options.coverSize || window.ON_DEFAULTS.coverSize || 1000);
    const quality = Number(options.quality || window.ON_DEFAULTS.quality || 100);
    const key = `${country}|${size}|${quality}|${cleanArtist}|${cleanTitle}`.toLowerCase();

    if (ARTWORK_CACHE.has(key)) return ARTWORK_CACHE.get(key);

    const persistent = await getPersistentArtwork(key);
    if (persistent.hit) {
      ARTWORK_CACHE.set(key, persistent.value);
      return persistent.value;
    }

    if (ARTWORK_IN_FLIGHT.has(key)) return ARTWORK_IN_FLIGHT.get(key);

    const requestPromise = queueArtworkRequest(async () => {
      const term = [cleanArtist, cleanTitle].filter(Boolean).join(" ");
      const search = new URLSearchParams({
        term,
        media: "music",
        entity: "song",
        limit: "5",
        country
      });

      const response = await fetch(`https://itunes.apple.com/search?${search.toString()}`, { cache: "force-cache" });
      if (response.status === 429 || response.status === 403) {
        throw new Error(`iTunes-Limit erreicht (HTTP ${response.status}).`);
      }
      if (!response.ok) throw new Error(`iTunes HTTP ${response.status}`);

      const data = await parseJsonResponse(response);
      const results = Array.isArray(data.results) ? data.results : [];
      let result = null;

      if (results.length) {
        const best = results
          .slice()
          .sort((a, b) => scoreArtworkResult(b, cleanArtist, cleanTitle) - scoreArtworkResult(a, cleanArtist, cleanTitle))[0];
        const artwork = best.artworkUrl100 || best.artworkUrl60 || "";
        result = artwork ? {
          url: artworkUrlSize(artwork, size, quality),
          originalUrl: artwork,
          album: fixTextEncoding(best.collectionName || ""),
          artistName: fixTextEncoding(best.artistName || cleanArtist),
          trackName: fixTextEncoding(best.trackName || cleanTitle)
        } : null;
      }

      ARTWORK_CACHE.set(key, result);
      await savePersistentArtwork(key, result);
      return result;
    }).finally(() => {
      ARTWORK_IN_FLIGHT.delete(key);
    });

    ARTWORK_IN_FLIGHT.set(key, requestPromise);
    return requestPromise;
  }

  function fallbackArtworkUrl() {
    return chrome.runtime.getURL("assets/kein-cover.png");
  }

  function streamUrl(json, slug, provider = "on") {
    if (json && json.__provider === "80s80s") {
      return normalizeUrl(json.streamUrl || json.urlHigh || json.urlLow || "");
    }
    return fixTextEncoding(
      (json && (json.mp3SSL || json.aacSSL || json.mp3 || json.aac)) ||
      (slug ? `https://${slug}.radionetz.de/${slug}.mp3` : "")
    );
  }

  function streamTitle(json) {
    if (json && json.__provider === "80s80s") return fixTextEncoding(json.title || "80s80s");
    return "";
  }

  function coverPageUrl(settings) {
    const provider = sanitizeProvider(settings.provider || "on");
    const fallbackChannel = providerInfo(provider).defaultChannel || window.ON_DEFAULTS.channel;
    const params = new URLSearchParams({
      provider,
      channel: sanitizeSlug(settings.channel || fallbackChannel),
      country: String(settings.country || window.ON_DEFAULTS.country || "DE"),
      size: String(settings.coverSize || settings.size || window.ON_DEFAULTS.coverSize || 1000),
      refresh: String(settings.refreshSeconds || settings.refresh || window.ON_DEFAULTS.refreshSeconds || 15),
      quality: String(settings.quality || window.ON_DEFAULTS.quality || 100),
      autoplay: String(settings.autoplay == null ? "1" : settings.autoplay)
    });

    if (settings.artworkUrl) params.set("artwork", String(settings.artworkUrl));
    if (settings.album) params.set("album", String(settings.album));
    if (settings.trackTitle) params.set("title", String(settings.trackTitle));
    if (settings.trackArtist) params.set("artist", String(settings.trackArtist));
    if (settings.played) params.set("played", String(settings.played));
    if (settings.channelTitle) params.set("channelTitle", String(settings.channelTitle));
    if (settings.streamUrl) params.set("streamUrl", String(settings.streamUrl));

    return chrome.runtime.getURL(`cover.html?${params.toString()}`);
  }

  function overviewPageUrl(settings) {
    const provider = sanitizeProvider(settings.provider || "on");
    const fallbackChannel = providerInfo(provider).defaultChannel || window.ON_DEFAULTS.channel;
    const params = new URLSearchParams({
      provider,
      channel: sanitizeSlug(settings.channel || fallbackChannel),
      country: String(settings.country || window.ON_DEFAULTS.country || "DE"),
      size: String(settings.coverSize || settings.size || window.ON_DEFAULTS.coverSize || 1000),
      refresh: String(settings.refreshSeconds || settings.refresh || window.ON_DEFAULTS.refreshSeconds || 15),
      quality: String(settings.quality || window.ON_DEFAULTS.quality || 100)
    });
    if (settings.query) params.set("q", settings.query);
    return chrome.runtime.getURL(`overview.html?${params.toString()}`);
  }

  window.ONCommon = {
    sanitizeProvider,
    providerInfo,
    sanitizeSlug,
    unique,
    variantsForSlug,
    findChannel,
    getCandidateSlugs,
    fetchNowPlaying,
    fetch80s80sApi,
    get80s80sChannels,
    getCurrentTrack,
    findArtwork,
    fixTextEncoding,
    artworkLookupKey,
    artworkUrlSize,
    isArtworkRateLimitError,
    streamUrl,
    streamTitle,
    normalizeUrl,
    fallbackArtworkUrl,
    coverPageUrl,
    overviewPageUrl
  };
})();
