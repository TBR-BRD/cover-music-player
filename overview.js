const DEFAULTS = window.ON_DEFAULTS;
const Common = window.ONCommon;

const params = new URLSearchParams(location.search);
const settings = {
  provider: Common.sanitizeProvider(params.get("provider") || window.CMP_DEFAULT_PROVIDER || "on"),
  channel: Common.sanitizeSlug(params.get("channel") || DEFAULTS.channel),
  country: params.get("country") || DEFAULTS.country,
  coverSize: Number(params.get("size")) || DEFAULTS.coverSize,
  refreshSeconds: Number(params.get("refresh")) || DEFAULTS.refreshSeconds,
  quality: Number(params.get("quality")) || DEFAULTS.quality
};

const providerInfo = Common.providerInfo(settings.provider);
const PREVIEW_COVER_SIZE = 300;
const PREVIEW_QUALITY = 80;
const PLAYER_COVER_SIZE = 1000;
const PLAYER_QUALITY = 100;
const OVERVIEW_REFRESH_SECONDS = Math.max(30, settings.refreshSeconds);

const grid = document.getElementById("grid");
const template = document.getElementById("cardTemplate");
const search = document.getElementById("search");
const cards = new Map();
let refreshTimer = null;
let updateInProgress = false;
let channels = [];

function setupHeader() {
  document.title = `${providerInfo.title} - Cover Music Player`;
  const heading = document.querySelector("h1");
  if (heading) heading.textContent = `${providerInfo.title}`;
  if (search) search.placeholder = providerInfo.searchPlaceholder || "Programm suchen";
}

function cardMatches(channel, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [channel.title, channel.slug, channel.stationId, ...(channel.slugs || [])]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function applyFilter() {
  const query = search.value;
  for (const [, card] of cards) {
    card.element.hidden = !cardMatches(card.channel, query);
  }
}

function openPlayer(card) {
  chrome.tabs.create({
    url: Common.coverPageUrl({
      ...settings,
      provider: card.channel.provider || settings.provider,
      channel: card.channel.slug,
      channelTitle: card.channel.title,
      coverSize: PLAYER_COVER_SIZE,
      quality: PLAYER_QUALITY,
      autoplay: "1",
      artworkUrl: card.playerArtworkUrl || (card.artwork && card.artwork.url),
      album: card.artwork && card.artwork.album,
      trackTitle: card.track && card.track.title,
      trackArtist: card.track && card.track.artist,
      played: card.track && card.track.played,
      streamUrl: (card.track && card.track.streamUrl) || card.channel.streamUrl || ""
    }),
    active: true
  });
}

function baseStatus(track) {
  return track && track.played ? `Seit ${track.played}` : "Live";
}

function setArtwork(card, url) {
  const finalUrl = url || Common.fallbackArtworkUrl();
  card.image.dataset.fallback = url ? "0" : "1";
  card.image.src = finalUrl;
  card.image.alt = url ? "Cover" : "Kein Cover gefunden";
  card.image.hidden = false;
  card.fallback.hidden = true;
}

function setDirectArtwork(card, track) {
  const original = track.coverOriginalUrl || track.coverUrl || "";

  card.artworkState = "done";
  card.artwork = original ? {
    url: Common.artworkUrlSize(original, PREVIEW_COVER_SIZE, PREVIEW_QUALITY),
    originalUrl: original,
    album: track.album || ""
  } : null;
  card.playerArtworkUrl = original
    ? Common.artworkUrlSize(original, PLAYER_COVER_SIZE, PLAYER_QUALITY)
    : "";

  setArtwork(card, card.artwork && card.artwork.url);
  card.status.textContent = original ? baseStatus(track) : `${baseStatus(track)} · Kein Cover`;
}

function requestCardArtwork(card, track) {
  if (track.coverOriginalUrl || track.coverUrl) {
    card.artworkLookupKey = Common.artworkLookupKey(track.artist, track.title);
    setDirectArtwork(card, track);
    return;
  }

  const lookupKey = Common.artworkLookupKey(track.artist, track.title);

  if (!lookupKey) {
    card.artworkLookupKey = "";
    card.artworkState = "done";
    card.artwork = null;
    card.playerArtworkUrl = "";
    setArtwork(card, null);
    card.status.textContent = `${baseStatus(track)} · Kein Cover`;
    return;
  }

  if (card.artworkLookupKey === lookupKey && (card.artworkState === "pending" || card.artworkState === "done")) {
    return;
  }

  card.artworkLookupKey = lookupKey;
  card.artworkState = "pending";
  card.artworkRequestId = (card.artworkRequestId || 0) + 1;
  const requestId = card.artworkRequestId;

  card.artwork = null;
  card.playerArtworkUrl = "";
  setArtwork(card, null);
  card.status.textContent = `${baseStatus(track)} · Cover wartet...`;

  Common.findArtwork(track.artist, track.title, {
    ...settings,
    coverSize: PREVIEW_COVER_SIZE,
    size: PREVIEW_COVER_SIZE,
    quality: PREVIEW_QUALITY
  }).then((artwork) => {
    if (requestId !== card.artworkRequestId || card.artworkLookupKey !== lookupKey) return;

    card.artworkState = "done";
    card.artwork = artwork || null;
    card.playerArtworkUrl = artwork
      ? Common.artworkUrlSize(artwork.originalUrl || artwork.url, PLAYER_COVER_SIZE, PLAYER_QUALITY)
      : "";
    setArtwork(card, artwork && artwork.url);
    card.status.textContent = artwork ? baseStatus(track) : `${baseStatus(track)} · Kein Cover`;
  }).catch((error) => {
    if (requestId !== card.artworkRequestId || card.artworkLookupKey !== lookupKey) return;

    card.artwork = null;
    card.playerArtworkUrl = "";
    setArtwork(card, null);

    if (Common.isArtworkRateLimitError(error)) {
      card.artworkState = "rate-error";
      card.status.textContent = `${baseStatus(track)} · Cover später`;
    } else {
      card.artworkState = "done";
      card.status.textContent = `${baseStatus(track)} · Kein Cover`;
    }
  });
}

async function updateCard(card) {
  try {
    card.status.textContent = "Aktualisiere...";
    const now = await Common.fetchNowPlaying(card.channel.slug, card.channel.provider || settings.provider);
    const track = Common.getCurrentTrack(now.json);
    const lookupKey = Common.artworkLookupKey(track.artist, track.title);

    track.streamUrl = Common.streamUrl(now.json, now.slug, now.provider);
    card.track = track;
    card.channel.streamUrl = track.streamUrl;
    card.channel.title = track.channelTitle || card.channel.title;
    card.artist.textContent = track.artist || "";
    card.title.textContent = track.title || "";

    if (lookupKey !== card.artworkLookupKey || card.artworkState === "rate-error" || track.coverOriginalUrl || track.coverUrl) {
      requestCardArtwork(card, track);
    } else {
      card.status.textContent = card.artworkState === "pending"
        ? `${baseStatus(track)} · Cover wartet...`
        : baseStatus(track);
    }
  } catch (error) {
    card.artist.textContent = "";
    card.title.textContent = "";
    card.status.textContent = error.message || "Nicht erreichbar";
    card.track = null;
    card.artwork = null;
    card.playerArtworkUrl = "";
    card.artworkLookupKey = "";
    card.artworkState = "done";
    setArtwork(card, null);
  }
}

async function update80s80sCards() {
  const entries = await Common.fetch80s80sApi(true);
  if (!cards.size) {
    render(Common.get80s80sChannels(entries));
    applyFilter();
  }

  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  for (const card of cards.values()) {
    const entry = bySlug.get(card.channel.slug);
    if (!entry) {
      card.status.textContent = "Nicht erreichbar";
      continue;
    }

    const track = Common.getCurrentTrack(entry);
    track.streamUrl = Common.streamUrl(entry, entry.slug, "80s80s");
    card.track = track;
    card.channel.streamUrl = track.streamUrl;
    card.channel.title = track.channelTitle || card.channel.title;
    card.h2.textContent = card.channel.title;
    card.artist.textContent = track.artist || "";
    card.title.textContent = track.title || "";

    requestCardArtwork(card, track);
  }
}

async function updateAllCards() {
  if (updateInProgress) return;
  updateInProgress = true;

  try {
    if (settings.provider === "80s80s") {
      await update80s80sCards();
      return;
    }

    const visible = [...cards.values()].filter((card) => !card.element.hidden);
    const concurrency = 8;
    let index = 0;

    async function worker() {
      while (index < visible.length) {
        const current = visible[index++];
        await updateCard(current);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
  } catch (error) {
    if (!cards.size) {
      const message = document.createElement("p");
      message.className = "overviewError";
      message.textContent = error.message || "Übersicht konnte nicht geladen werden.";
      grid.replaceChildren(message);
    }
  } finally {
    updateInProgress = false;
  }
}

function render(nextChannels) {
  channels = nextChannels.map((channel) => ({
    provider: settings.provider,
    ...channel,
    provider: channel.provider || settings.provider
  }));

  grid.replaceChildren();
  cards.clear();

  for (const channel of channels) {
    const fragment = template.content.cloneNode(true);
    const element = fragment.querySelector(".card");
    const button = fragment.querySelector(".coverButton");
    const image = fragment.querySelector(".cover");
    const fallback = fragment.querySelector(".fallback");
    const h2 = fragment.querySelector("h2");
    const artist = fragment.querySelector(".artist");
    const title = fragment.querySelector(".title");
    const status = fragment.querySelector(".status");

    h2.textContent = channel.title;
    fallback.textContent = settings.provider === "80s80s" ? "80s" : (channel.title === "BurnFM" ? "FM" : "ON");
    artist.textContent = "";
    title.textContent = "";
    status.textContent = "Warte...";

    const card = {
      channel,
      element,
      button,
      image,
      fallback,
      h2,
      artist,
      title,
      status,
      track: null,
      artwork: null,
      playerArtworkUrl: "",
      artworkLookupKey: "",
      artworkState: "idle",
      artworkRequestId: 0
    };

    image.addEventListener("error", () => {
      if (image.dataset.fallback === "1") {
        image.hidden = true;
        fallback.hidden = false;
        return;
      }
      setArtwork(card, null);
    });
    button.addEventListener("click", () => openPlayer(card));
    cards.set(channel.slug, card);
    grid.append(element);
  }
}

async function init() {
  setupHeader();
  search.value = params.get("q") || "";
  search.addEventListener("input", () => {
    applyFilter();
    updateAllCards();
  });

  if (settings.provider === "80s80s") {
    const loading = document.createElement("p");
    loading.className = "overviewError";
    loading.textContent = "80s80s-Programme werden geladen...";
    grid.replaceChildren(loading);
  } else {
    render((window.ON_CHANNELS || []).map((channel) => ({ ...channel, provider: "on" })));
    applyFilter();
  }

  await updateAllCards();
  refreshTimer = setInterval(updateAllCards, OVERVIEW_REFRESH_SECONDS * 1000);
}

init();
window.addEventListener("beforeunload", () => clearInterval(refreshTimer));
