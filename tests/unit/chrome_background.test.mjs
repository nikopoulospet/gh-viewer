// The Chrome service worker, exercised against a fake `chrome`.
//
// This is the one piece of the port no browser in the suite can cover: the
// fallback only runs on a Chromium that has no chrome.sidePanel, and the smoke
// test's Chromium has one. Arc is the browser that actually hits it, and there
// is no headless Arc to drive - so the branch is tested by withholding the API
// rather than by finding a browser that lacks it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(
  path.join(HERE, "..", "..", "chrome", "background.js"), "utf8");

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";

// `chrome` as the worker sees it. `sidePanel` is omitted entirely rather than
// set to undefined when absent, because that is what Arc does and it is the
// difference between a throw and a rejected promise.
function fakeChrome({ sidePanel = "ok", tabs = [] } = {}) {
  const calls = { behaviour: [], listeners: [], created: [], updated: [], focused: [] };
  const api = {
    runtime: { getURL: (p) => EXTENSION_ORIGIN + p },
    action: { onClicked: { addListener: (fn) => calls.listeners.push(fn) } },
    tabs: {
      query: async () => tabs.slice(),
      create: async (options) => { calls.created.push(options); },
      update: async (id, options) => { calls.updated.push({ id, ...options }); },
    },
    windows: {
      update: async (id, options) => { calls.focused.push({ id, ...options }); },
    },
  };

  if (sidePanel === "ok") {
    api.sidePanel = {
      setPanelBehavior: async (b) => { calls.behaviour.push(b); },
    };
  } else if (sidePanel === "refuses") {
    api.sidePanel = {
      setPanelBehavior: async () => { throw new Error("not available"); },
    };
  }
  return { api, calls };
}

function run(chrome) {
  const context = { chrome, console: { warn() {}, error() {} } };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
}

// The worker's last statement is async; let its promise chain settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("on Chrome the toolbar button is handed to the side panel", async () => {
  const { api, calls } = fakeChrome();
  run(api);
  await settle();

  // Objects made inside the vm belong to another realm, so their fields are
  // compared rather than the objects themselves.
  assert.equal(calls.behaviour.length, 1);
  assert.equal(calls.behaviour[0].openPanelOnActionClick, true);
  // Chrome opens the panel itself; an onClicked listener would never fire.
  assert.equal(calls.listeners.length, 0);
});

test("on a Chromium without sidePanel the button opens the panel in a tab", async () => {
  const { api, calls } = fakeChrome({ sidePanel: "absent" });
  run(api);
  await settle();

  assert.equal(calls.listeners.length, 1, "no click handler was registered");
  await calls.listeners[0]();
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].url, `${EXTENSION_ORIGIN}sidebar/panel.html`);
});

test("a missing sidePanel does not take the service worker down with it", () => {
  const { api } = fakeChrome({ sidePanel: "absent" });
  // Reading .setPanelBehavior off undefined is a TypeError, and an uncaught one
  // here kills the worker - so the button would stay dead even with a fallback
  // registered after it.
  assert.doesNotThrow(() => run(api));
});

test("a sidePanel that refuses falls back too", async () => {
  const { api, calls } = fakeChrome({ sidePanel: "refuses" });
  run(api);
  await settle();

  assert.equal(calls.listeners.length, 1, "a rejected setPanelBehavior was not handled");
});

test("an already-open panel tab is focused rather than duplicated", async () => {
  const url = `${EXTENSION_ORIGIN}sidebar/panel.html`;
  const { api, calls } = fakeChrome({
    sidePanel: "absent",
    tabs: [{ id: 7, windowId: 3, url: "https://github.com/" }, { id: 9, windowId: 4, url }],
  });
  run(api);
  await settle();
  await calls.listeners[0]();

  assert.equal(calls.created.length, 0, "a duplicate tab was opened");
  assert.deepEqual(calls.updated, [{ id: 9, active: true }]);
  assert.deepEqual(calls.focused, [{ id: 4, focused: true }]);
});
