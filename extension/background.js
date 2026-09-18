"use strict";
// The toolbar button toggles the sidebar; everything else happens in the panel.
browser.action.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});
