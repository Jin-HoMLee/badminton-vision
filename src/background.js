/* Runtime bridge only. Inference remains behind this explicit message boundary. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_RUNTIME_STATUS") {
    sendResponse({ available: false, reason: "Inference runtime is not bundled in the public UI build." });
    return false;
  }
  if (message?.type === "OPEN_SUMMARY") {
    chrome.tabs.create({ url: chrome.runtime.getURL("summary.html") });
    return false;
  }
  return false;
});
