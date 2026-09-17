import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage, mockBrowser, mockFetch, fixture, settle } from "../harness.mjs";

const SIGNED_IN = { token: "ghu_test", viewer: { login: "octocat" } };

function text(dom, selector) {
  return [...dom.window.document.querySelectorAll(selector)].map((n) => n.textContent);
}

test("every panel script evaluates in one shared scope", async () => {
  // Regression: each lib file used to declare `const GV` at top level, which is
  // a redeclaration SyntaxError that silently killed every script after the
  // first. loadPage evaluates them in one window, so that failure reappears here.
  const dom = await loadPage("sidebar/panel.html", { browser: mockBrowser() });
  const GV = dom.window.GV;
  for (const key of ["store", "auth", "api", "render", "DETAIL_DOC", "BUILT_IN_CLIENT_ID"]) {
    assert.ok(GV?.[key], `GV.${key} should exist after loading the panel`);
  }
});

test("without a token the panel asks you to connect", async () => {
  const dom = await loadPage("sidebar/panel.html", { browser: mockBrowser() });
  await settle();
  assert.match(dom.window.document.body.textContent, /Sign in to GitHub/);
  assert.match(dom.window.document.body.textContent, /installed on the account or org/);
});

test("a search response renders one row per result", async () => {
  const fetch = mockFetch([fixture("search")]);
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser(SIGNED_IN),
    fetch,
  });
  await settle();

  const titles = text(dom, ".row .title");
  assert.equal(titles.length, 3);
  assert.equal(titles[0], "Retry flaky uploads instead of failing the batch");

  // Repo and number come from different fields; the row joins them.
  assert.ok(text(dom, ".row .num").includes("example-org/example-repo#41"));

  const chips = text(dom, ".row .chips .chip");
  assert.ok(chips.includes("draft"), "the draft PR should be marked");
  assert.ok(chips.includes("ci ok"), "a SUCCESS rollup should show as passing");
  assert.ok(chips.includes("ci failed"), "a FAILURE rollup should show as failing");
  assert.ok(chips.includes("approved"), "reviewDecision should render");
  assert.ok(chips.includes("bug"), "labels should render");

  assert.match(dom.window.document.getElementById("status").textContent, /3 of 3/);
  assert.match(dom.window.document.getElementById("status").textContent, /4987/);

  // Regression: seeding the default queries used to write to storage, whose
  // change event re-booted the panel and ran the query a second time.
  assert.equal(fetch.requests.length, 1, "first render must issue exactly one query");
});

test("clicking a row drills down with the detail query", async () => {
  const fetch = mockFetch([fixture("search"), fixture("detail")]);
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser(SIGNED_IN),
    fetch,
  });
  await settle();

  dom.window.document.querySelector(".row").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true })
  );
  await settle();

  const detailRequest = fetch.requests.at(-1);
  assert.match(detailRequest.body.query, /node\(id: \$id\)/);
  assert.equal(detailRequest.body.variables.id, "PR_kwSYNTHETIC1");

  const body = dom.window.document.body.textContent;
  assert.match(body, /Checks/);
  assert.match(body, /unit/);
  assert.match(body, /Does this cover the multipart path too\?/);

  // The back control only exists in the detail view.
  assert.equal(dom.window.document.getElementById("back").hidden, false);
});

test("links open in a new tab instead of navigating the sidebar", async () => {
  const browser = mockBrowser(SIGNED_IN);
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  const link = dom.window.document.querySelector(".row .open");
  const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  await settle();

  assert.equal(browser.calls.tabs.length, 1);
  assert.equal(browser.calls.tabs[0].url, "https://github.com/example-org/example-repo/pull/41");
  assert.equal(browser.calls.tabs[0].active, true);
  assert.ok(event.defaultPrevented, "the navigation itself must be cancelled");
});

test("ctrl-click sends the tab to the background", async () => {
  const browser = mockBrowser(SIGNED_IN);
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  dom.window.document.querySelector(".row .open").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })
  );
  await settle();
  assert.equal(browser.calls.tabs[0].active, false);
});

test("a partial GraphQL error is reported, not swallowed", async () => {
  // GitHub answers with data AND errors when the App cannot read a field.
  // The rows still have to render, with the gap called out.
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser(SIGNED_IN),
    fetch: mockFetch([fixture("partial")]),
  });
  await settle();

  assert.equal(text(dom, ".row .title").length, 1);
  const status = dom.window.document.getElementById("status");
  assert.match(status.textContent, /partial: Resource not accessible by integration/);
  assert.equal(status.className, "warn");
});

test("a rejected token drops back to the connect screen", async () => {
  const browser = mockBrowser(SIGNED_IN);
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([{ status: 401, body: { message: "Bad credentials" } }]),
  });
  await settle();

  assert.match(dom.window.document.body.textContent, /Sign in to GitHub/);
  assert.equal(await browser.api.storage.local.get("token").then((r) => r.token), undefined);
});
