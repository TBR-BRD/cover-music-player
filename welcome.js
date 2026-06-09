const DEFAULTS = window.ON_DEFAULTS;
const Common = window.ONCommon;

function openOverview(provider) {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    const info = Common.providerInfo(provider);
    chrome.tabs.create({
      url: Common.overviewPageUrl({
        ...settings,
        provider,
        channel: info.defaultChannel || settings.channel
      }),
      active: true
    });
  });
}

document.getElementById("openOnOverview").addEventListener("click", () => openOverview("on"));
document.getElementById("open80sOverview").addEventListener("click", () => openOverview("80s80s"));

document.getElementById("closePage").addEventListener("click", () => {
  window.close();
});
