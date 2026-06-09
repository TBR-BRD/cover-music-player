chrome.runtime.onInstalled.addListener((details) => {
  const version = chrome.runtime.getManifest().version;
  const shouldOpen = details.reason === "install" || details.reason === "update";

  if (!shouldOpen) return;

  chrome.storage.local.get(["pinHelpShownVersion"], (result) => {
    if (result.pinHelpShownVersion === version) return;

    chrome.storage.local.set({ pinHelpShownVersion: version }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html"), active: true });
    });
  });
});
