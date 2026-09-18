"use strict";
// Chrome's counterpart to extension/background.js. There is no toggle API for
// the side panel, so the toolbar button is wired up declaratively instead and
// Chrome opens the panel itself - which also keeps the click a user gesture.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("gh-viewer: could not wire the action button", e));
