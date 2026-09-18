// GV.access: turning the App's installations into "what can I read?".
//
// The interesting cases are the ones a user actually hits and cannot otherwise
// distinguish: no installation at all, an installation scoped to a few repos,
// and an installation whose repository list will not load.

import assert from "node:assert/strict";
import test from "node:test";
import { loadPage, mockBrowser, settle } from "../harness.mjs";

// GV.access talks to REST, not GraphQL, so the fetch stub here answers paths
// rather than documents.
function mockRest(routes) {
  const requests = [];
  const fn = async (url, options) => {
    requests.push({ url, headers: options?.headers || {} });
    const path = url.replace("https://api.github.com", "");
    const reply = routes[path];
    if (reply === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (reply instanceof Error) throw reply;
    if (reply.status) {
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body ?? {} };
    }
    return { ok: true, status: 200, json: async () => reply };
  };
  fn.requests = requests;
  return fn;
}

// Arrays built inside jsdom belong to another realm, so deepStrictEqual sees a
// prototype mismatch. Copy into a host array before comparing.
const plain = (items) => [...items];

const INSTALLATIONS = "/user/installations";
const repoPath = (id, page = 1) =>
  `/user/installations/${id}/repositories?per_page=100&page=${page}`;

async function access(routes, { token = "ghu_x" } = {}) {
  const browser = mockBrowser({ token });
  const dom = await loadPage("options/options.html", { browser, fetch: mockRest(routes) });
  await settle();
  return dom.window.GV.access;
}

test("an account with every repository is reported as such", async () => {
  const gv = await access({
    [INSTALLATIONS]: {
      installations: [
        { id: 1, account: { login: "infinitesky", type: "Organization" },
          repository_selection: "all" },
      ],
    },
    [repoPath(1)]: {
      repositories: [
        { full_name: "infinitesky/hermes", private: true },
        { full_name: "infinitesky/atlas", private: false },
      ],
    },
  });

  const [entry] = await gv.list();
  assert.equal(entry.account, "infinitesky");
  assert.equal(entry.type, "Organization");
  assert.equal(entry.everyRepository, true);
  // Sorted, so the list does not reshuffle between checks.
  assert.deepEqual(plain(entry.repositories.map((r) => r.name)),
                   ["infinitesky/atlas", "infinitesky/hermes"]);
  assert.equal(entry.repositories.find((r) => r.name.endsWith("hermes")).private, true);
});

test("a selected-repositories install is distinguishable from an absent one", async () => {
  const gv = await access({
    [INSTALLATIONS]: {
      installations: [
        { id: 2, account: { login: "infinitesky", type: "Organization" },
          repository_selection: "selected" },
      ],
    },
    [repoPath(2)]: { repositories: [{ full_name: "infinitesky/atlas", private: true }] },
  });

  const [entry] = await gv.list();
  assert.equal(entry.everyRepository, false);
  // The case that started this: the org IS installed, just not on the repo you
  // wanted. An empty sidebar looks identical to "not installed" without this.
  assert.deepEqual(plain(entry.repositories.map((r) => r.name)), ["infinitesky/atlas"]);
});

test("no installations anywhere comes back empty rather than throwing", async () => {
  const gv = await access({ [INSTALLATIONS]: { installations: [] } });
  assert.deepEqual(plain(await gv.list()), []);
});

test("one installation failing does not hide the others", async () => {
  const gv = await access({
    [INSTALLATIONS]: {
      installations: [
        { id: 1, account: { login: "good", type: "User" }, repository_selection: "all" },
        { id: 2, account: { login: "broken", type: "Organization" },
          repository_selection: "all" },
      ],
    },
    [repoPath(1)]: { repositories: [{ full_name: "good/repo", private: false }] },
    [repoPath(2)]: { status: 500 },
  });

  const entries = await gv.list();
  const good = entries.find((e) => e.account === "good");
  const broken = entries.find((e) => e.account === "broken");
  assert.deepEqual(plain(good.repositories.map((r) => r.name)), ["good/repo"]);
  assert.match(broken.error, /500/);
  assert.deepEqual(plain(broken.repositories), []);
});

test("repositories are paged until a short page arrives", async () => {
  const page = (n, count) => ({
    repositories: Array.from({ length: count }, (_, i) => ({
      full_name: `org/repo-${n}-${i}`, private: false,
    })),
  });
  const gv = await access({
    [INSTALLATIONS]: {
      installations: [
        { id: 5, account: { login: "org", type: "Organization" },
          repository_selection: "all" },
      ],
    },
    [repoPath(5, 1)]: page(1, 100),
    [repoPath(5, 2)]: page(2, 7),
  });

  const [entry] = await gv.list();
  assert.equal(entry.repositories.length, 107);
  assert.equal(entry.truncated, false);
});

test("the REST call carries the token and asks for the v3 media type", async () => {
  const fetch = mockRest({ [INSTALLATIONS]: { installations: [] } });
  const browser = mockBrowser({ token: "ghu_secret" });
  const dom = await loadPage("options/options.html", { browser, fetch });
  await settle();
  await dom.window.GV.access.list();

  const [request] = fetch.requests;
  assert.equal(request.headers.Authorization, "bearer ghu_secret");
  assert.equal(request.headers.Accept, "application/vnd.github+json");
});

test("the Access tab is wired into the options page", async () => {
  const browser = mockBrowser({ token: "ghu_x" });
  const dom = await loadPage("options/options.html", {
    browser, fetch: mockRest({ [INSTALLATIONS]: { installations: [] } }),
  });
  await settle();
  const { document } = dom.window;

  const tab = document.querySelector('.tab[data-tab="access"]');
  assert.ok(tab, "no Access tab button");
  assert.equal(document.getElementById("tab-access").hidden, true, "starts hidden");

  tab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(document.getElementById("tab-access").hidden, false, "clicking did not open it");

  // The install link is only useful if it actually points at the App.
  assert.equal(document.getElementById("install-link").href,
               "https://github.com/apps/gh-viewer-sidebar/installations/new");
});
