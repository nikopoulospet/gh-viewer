"use strict";
// Firefox: the toolbar button toggles the sidebar. Chrome has no toggle API and
// uses a different mechanism entirely, so its build overlays chrome/background.js
// over this file - see tools/build_chrome.py.
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});
