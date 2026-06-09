const DEFAULTS = window.ON_DEFAULTS;
const Common = window.ONCommon;

const country = document.getElementById("country");
const coverSize = document.getElementById("coverSize");
const refreshSeconds = document.getElementById("refreshSeconds");
const quality = document.getElementById("quality");
const status = document.getElementById("status");

function currentSettings(provider = "on") {
  const info = Common.providerInfo(provider);
  return {
    provider: info.id,
    channel: info.defaultChannel || DEFAULTS.channel,
    country: country.value || DEFAULTS.country,
    coverSize: Number(coverSize.value) || DEFAULTS.coverSize,
    refreshSeconds: Number(refreshSeconds.value) || DEFAULTS.refreshSeconds,
    quality: Number(quality.value) || DEFAULTS.quality
  };
}

function applySettings(settings) {
  const merged = { ...DEFAULTS, ...settings };
  country.value = merged.country;
  coverSize.value = String(merged.coverSize);
  refreshSeconds.value = String(merged.refreshSeconds);
  quality.value = String(merged.quality);
}

function saveSettings(callback, provider = "on") {
  const settings = currentSettings(provider);
  chrome.storage.sync.set(settings, () => {
    status.textContent = "Gespeichert.";
    if (callback) callback(settings);
  });
  return settings;
}

document.getElementById("saveOnly").addEventListener("click", () => saveSettings());

function openOverview(provider, label) {
  saveSettings((settings) => {
    chrome.tabs.create({ url: Common.overviewPageUrl(settings), active: true }, () => {
      status.textContent = `${label} geöffnet.`;
    });
  }, provider);
}

document.getElementById("openOnOverview").addEventListener("click", () => openOverview("on", "ON Radio"));
document.getElementById("open80sOverview").addEventListener("click", () => openOverview("80s80s", "80s80s"));

chrome.storage.sync.get(DEFAULTS, applySettings);
