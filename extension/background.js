"use strict";
// The toolbar button toggles the sidebar; everything else happens in the panel.
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});
