"use strict";
// Chrome's counterpart to extension/background.js. Chrome has no toggle API for
// the side panel, so the toolbar button is wired up declaratively and Chrome
// opens the panel itself - which also keeps the click a user gesture.
//
// Not every Chromium is Chrome. Arc ships no chrome.sidePanel at all, so there
// the button has nothing to open and the panel is unreachable. Those browsers
// get the same page as a tab instead. The alternative - painting a panel over
// every site from a content script - would need access to the whole web, which
// this extension deliberately does not ask for.

const PANEL_PAGE = "sidebar/panel.html";

// Mirrors the panel's own link handling: reuse the tab already showing it
// rather than stacking up duplicates.
async function openPanelTab(api) {
  const url = api.runtime.getURL(PANEL_PAGE);
  const tabs = await api.tabs.query({});
  const open = tabs.find((tab) => tab.url === url);
  if (open) {
    await api.tabs.update(open.id, { active: true });
    await api.windows.update(open.windowId, { focused: true });
    return;
  }
  await api.tabs.create({ url });
}

function wireActionButton(api) {
  const fallback = (reason) => {
    console.warn("gh-viewer: no side panel here, opening the panel in a tab", reason);
    api.action.onClicked.addListener(() => openPanelTab(api));
  };

  // A missing sidePanel throws on property access rather than rejecting, so a
  // promise catch alone would not see it - and the throw would kill the worker.
  try {
    return api.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(fallback);
  } catch (e) {
    fallback(e);
    return Promise.resolve();
  }
}

wireActionButton(chrome);
