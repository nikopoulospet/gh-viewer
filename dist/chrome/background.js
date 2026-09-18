"use strict";
// Chrome's MV3 service worker. Replaces extension/background.js in the Chrome
// build; everything else in the extension is shared verbatim.
globalThis.browser ??= globalThis.chrome;

// Chrome has no sidebarAction.toggle, and sidePanel.open() requires a user
// gesture. Asking Chrome to open the panel on toolbar-icon clicks gives the same
// one-click behaviour without needing to handle the click ourselves.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("gh-viewer: could not configure the side panel", e));
