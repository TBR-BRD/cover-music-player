const Common = window.ONCommon;
const DEFAULTS = window.ON_DEFAULTS;

const params = new URLSearchParams(location.search);
const provider = Common.sanitizeProvider(params.get("provider") || window.CMP_DEFAULT_PROVIDER || "on");
const providerInfo = Common.providerInfo(provider);
const settings = {
  provider,
  channel: Common.sanitizeSlug(params.get("channel") || providerInfo.defaultChannel || DEFAULTS.channel),
  country: params.get("country") || DEFAULTS.country,
  coverSize: Number(params.get("size")) || DEFAULTS.coverSize,
  refreshSeconds: Number(params.get("refresh")) || DEFAULTS.refreshSeconds,
  quality: Number(params.get("quality")) || DEFAULTS.quality,
  autoplay: params.get("autoplay") !== "0",
  initialArtwork: params.get("artwork") || "",
  initialAlbum: Common.fixTextEncoding(params.get("album") || ""),
  initialTitle: Common.fixTextEncoding(params.get("title") || ""),
  initialArtist: Common.fixTextEncoding(params.get("artist") || ""),
  initialPlayed: Common.fixTextEncoding(params.get("played") || ""),
  initialChannelTitle: Common.fixTextEncoding(params.get("channelTitle") || ""),
  initialStreamUrl: Common.normalizeUrl(params.get("streamUrl") || "")
};

const channel = Common.findChannel(settings.channel, settings.provider);
const channelTitle = document.getElementById("channelTitle");
const trackTitle = document.getElementById("trackTitle");
const artistName = document.getElementById("artistName");
const albumName = document.getElementById("albumName");
const played = document.getElementById("played");
const statusText = document.getElementById("status");
const cover = document.getElementById("cover");
const placeholder = document.getElementById("placeholder");
const audio = document.getElementById("audio");
const playButton = document.getElementById("playButton");
const volumeControl = document.getElementById("volumeControl");
const volumeValue = document.getElementById("volumeValue");
const VOLUME_STORAGE_KEY = "playerVolume";

let lastTrackKey = "";
let currentArtworkLookupKey = "";
let artworkRequestId = 0;
let wantsPlayback = settings.autoplay;
let lastStreamUrl = "";
const initialArtworkLookupKey = Common.artworkLookupKey(settings.initialArtist, settings.initialTitle);
let updateTimer = null;
let artworkRetryTimer = null;

channelTitle.textContent = settings.initialChannelTitle || (channel ? channel.title : providerInfo.title || settings.channel);

if (settings.initialTitle || settings.initialArtist || settings.initialAlbum || settings.initialArtwork) {
  trackTitle.textContent = settings.initialTitle || "Lade Titel...";
  artistName.textContent = settings.initialArtist || "";
  albumName.textContent = settings.initialAlbum || "";
  played.textContent = settings.initialPlayed ? `Gestartet: ${settings.initialPlayed}` : "";
  showCover(settings.initialArtwork);
}

cover.addEventListener("error", () => {
  if (cover.dataset.fallback === "1") {
    cover.removeAttribute("src");
    cover.hidden = true;
    placeholder.hidden = false;
    return;
  }
  showCover(null);
  if (!albumName.textContent) albumName.textContent = "Cover konnte nicht geladen werden.";
});

function setStatus(message) {
  statusText.textContent = message || "";
}

function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(number, 1));
}

function renderVolume(value) {
  const percent = Math.round(clampVolume(value) * 100);
  volumeControl.value = String(percent);
  volumeValue.textContent = `${percent}%`;
}

function setPlayerVolume(value, save = false) {
  const volume = clampVolume(value);
  audio.volume = volume;
  if (volume > 0 && audio.muted) audio.muted = false;
  renderVolume(volume);
  if (save && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: volume });
  }
}

function loadStoredVolume() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      setPlayerVolume(1, false);
      resolve();
      return;
    }

    chrome.storage.local.get({ [VOLUME_STORAGE_KEY]: 1 }, (items) => {
      setPlayerVolume(items[VOLUME_STORAGE_KEY], false);
      resolve();
    });
  });
}

function trackKey(track) {
  return [track.artist, track.title, track.played, track.duration, track.coverOriginalUrl || track.coverUrl]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("\u0001");
}

function artworkKey(track) {
  return [track.artist, track.title]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("\u0001");
}

function showCover(url) {
  const finalUrl = url || Common.fallbackArtworkUrl();
  cover.dataset.fallback = url ? "0" : "1";
  cover.alt = url ? "Albumcover" : "Kein Cover gefunden";
  cover.src = finalUrl;
  cover.hidden = false;
  placeholder.hidden = true;
}

function updateTrackText(track) {
  if (track.channelTitle) channelTitle.textContent = track.channelTitle;
  trackTitle.textContent = track.title || "Unbekannter Titel";
  artistName.textContent = track.artist || "";
  played.textContent = track.played
    ? `Gestartet: ${track.played}${track.duration ? ` · Dauer: ${track.duration}` : ""}`
    : "";

  document.title = track.title && track.artist
    ? `${track.artist} - ${track.title}`
    : `${channelTitle.textContent || "Cover Music Player"}`;
}

async function updateArtwork(track) {
  const lookupKey = artworkKey(track);

  if (artworkRetryTimer) {
    clearTimeout(artworkRetryTimer);
    artworkRetryTimer = null;
  }
  const requestId = ++artworkRequestId;
  currentArtworkLookupKey = lookupKey;

  const directArtwork = track.coverOriginalUrl || track.coverUrl || "";
  if (directArtwork) {
    showCover(Common.artworkUrlSize(directArtwork, settings.coverSize, settings.quality));
    albumName.textContent = track.album || "";
    return;
  }

  if (!track.artist && !track.title) {
    showCover(null);
    albumName.textContent = "Kein Cover gefunden.";
    return;
  }

  albumName.textContent = "Cover wird gesucht...";

  try {
    const artwork = await Common.findArtwork(track.artist, track.title, settings);
    if (requestId !== artworkRequestId || currentArtworkLookupKey !== lookupKey) return;

    if (artwork && artwork.url) {
      showCover(artwork.url);
      albumName.textContent = artwork.album || "";
    } else {
      showCover(null);
      albumName.textContent = "Kein Cover gefunden.";
    }
  } catch (error) {
    if (requestId !== artworkRequestId || currentArtworkLookupKey !== lookupKey) return;

    if (Common.isArtworkRateLimitError(error)) {
      showCover(null);
      albumName.textContent = "Cover-Limit erreicht. Neuer Versuch in 60 Sekunden.";
      artworkRetryTimer = setTimeout(() => {
        if (currentArtworkLookupKey === lookupKey) updateArtwork(track);
      }, 60000);
      return;
    }

    showCover(null);
    albumName.textContent = "Cover konnte nicht geladen werden.";
  }
}

async function startPlayback() {
  if (!audio.src) return;
  wantsPlayback = true;
  try {
    await audio.play();
    playButton.hidden = true;
    setStatus("Stream läuft.");
  } catch (_error) {
    playButton.hidden = false;
    setStatus("Autoplay wurde blockiert. Bitte Stream starten klicken.");
  }
}

function updateAudioSource(url) {
  const normalized = Common.normalizeUrl(url || "");
  if (!normalized || normalized === lastStreamUrl) return;
  lastStreamUrl = normalized;
  audio.src = normalized;
  audio.load();
}

async function refresh() {
  try {
    const now = await Common.fetchNowPlaying(settings.channel, settings.provider);
    const track = Common.getCurrentTrack(now.json);
    const stream = Common.streamUrl(now.json, now.slug, now.provider);
    const key = trackKey(track);
    const changed = key !== lastTrackKey;

    updateAudioSource(stream);
    updateTrackText(track);

    if (changed) {
      lastTrackKey = key;
      const currentLookupKey = artworkKey(track);
      if (settings.initialArtwork && initialArtworkLookupKey && currentLookupKey === initialArtworkLookupKey && !(track.coverOriginalUrl || track.coverUrl)) {
        currentArtworkLookupKey = currentLookupKey;
        showCover(settings.initialArtwork);
        albumName.textContent = settings.initialAlbum || albumName.textContent || "";
      } else {
        updateArtwork(track);
      }
    }

    if (wantsPlayback && audio.paused) {
      await startPlayback();
    } else if (!audio.paused) {
      playButton.hidden = true;
      setStatus("Stream läuft.");
    } else {
      setStatus(changed ? "Titel aktualisiert." : "Bereit.");
    }
  } catch (error) {
    setStatus(`Fehler: ${error.message}`);
  }
}

playButton.addEventListener("click", startPlayback);

volumeControl.addEventListener("input", () => {
  setPlayerVolume(Number(volumeControl.value) / 100, true);
});

audio.addEventListener("volumechange", () => {
  renderVolume(audio.volume);
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: clampVolume(audio.volume) });
  }
});

audio.addEventListener("play", () => {
  wantsPlayback = true;
  playButton.hidden = true;
  setStatus("Stream läuft.");
});

audio.addEventListener("pause", () => {
  setStatus("Stream pausiert.");
});

async function init() {
  await loadStoredVolume();
  if (settings.initialStreamUrl) updateAudioSource(settings.initialStreamUrl);
  await refresh();
  updateTimer = setInterval(refresh, Math.max(10, settings.refreshSeconds) * 1000);
}

init();
window.addEventListener("beforeunload", () => {
  clearInterval(updateTimer);
  if (artworkRetryTimer) clearTimeout(artworkRetryTimer);
});
