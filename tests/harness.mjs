// Loads a real extension page into jsdom with a mocked WebExtension API.
//
// Scripts are evaluated one after another in the same window, exactly as the
// browser does for classic <script src> tags. That detail matters: it is what
// makes a top-level redeclaration between two files fail here the same way it
// fails in Firefox, instead of passing and breaking only in the browser.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.join(HERE, "..", "extension");

export function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", `${name}.json`), "utf8"));
}

export function mockBrowser(initial = {}) {
  const store = { ...initial };
  const changeListeners = [];
  const calls = { tabs: [], options: 0, sets: [] };

  const api = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...store };
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            wanted.filter((k) => k in store).map((k) => [k, store[k]])
          );
        },
        async set(values) {
          Object.assign(store, values);
          calls.sets.push(values);
          const changes = Object.fromEntries(
            Object.entries(values).map(([k, v]) => [k, { newValue: v }])
          );
          for (const fn of changeListeners) fn(changes, "local");
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete store[k];
        },
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    tabs: {
      async create(options) {
        calls.tabs.push(options);
        return { id: calls.tabs.length };
      },
    },
    runtime: {
      openOptionsPage: async () => { calls.options += 1; },
      sendMessage: async () => ({}),
    },
  };

  return { api, calls, store };
}

// Queues a sequence of GraphQL replies; each fetch takes the next one.
// Records the request bodies so tests can assert which document was sent.
export function mockFetch(replies) {
  const queue = [...replies];
  const requests = [];
  const fn = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status ? reply.status < 400 : true,
      status: reply.status || 200,
      json: async () => reply.body ?? reply,
    };
  };
  fn.requests = requests;
  return fn;
}

export async function loadPage(relativeHtml, { browser, fetch } = {}) {
  const htmlPath = path.join(EXTENSION, relativeHtml);
  const html = fs.readFileSync(htmlPath, "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://localhost/" });

  dom.window.browser = (browser || mockBrowser()).api;
  if (fetch) dom.window.fetch = fetch;

  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of srcs) {
    const file = path.resolve(path.dirname(htmlPath), src);
    try {
      dom.window.eval(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`${src} failed to evaluate: ${e.message}`);
    }
  }

  return dom;
}

// Lets queued promises and timers resolve before assertions run.
export async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
