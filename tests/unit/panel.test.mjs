import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage, mockBrowser, mockFetch, fixture, settle } from "../harness.mjs";

const SIGNED_IN = { token: "ghu_test", viewer: { login: "octocat" } };

function text(dom, selector) {
  return [...dom.window.document.querySelectorAll(selector)].map((n) => n.textContent);
}

function clickConnect(dom) {
  const button = [...dom.window.document.querySelectorAll("button")]
    .find((b) => b.textContent === "Connect");
  assert.ok(button, "the connect screen should offer a Connect button");
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
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

test("connecting asks for the github.com/login host permission first", async () => {
  const browser = mockBrowser();
  const fetch = mockFetch([
    // Fractional `interval` only to keep the poll's sleep (x1000) to a millisecond.
    { body: { device_code: "dc", user_code: "ABCD-1234", interval: 0.001, expires_in: 900,
              verification_uri: "https://github.com/login/device" } },
    { body: { access_token: "ghu_granted" } },
    { body: { data: { viewer: { login: "octocat" } } } },
    fixture("search"),
  ]);
  const dom = await loadPage("sidebar/panel.html", { browser, fetch });
  await settle();

  clickConnect(dom);
  await settle(50);

  assert.equal(browser.calls.permissionRequests.length, 1);
  // Spread because the array comes from the page's realm: deep-equal checks prototypes.
  assert.deepEqual(
    [...browser.calls.permissionRequests[0].origins],
    ["https://github.com/login/*"]
  );
  assert.equal(fetch.requests[0].url, "https://github.com/login/device/code",
    "the permission must be held before the first request to that origin");
  assert.equal(
    await browser.api.storage.local.get("token").then((r) => r.token),
    "ghu_granted",
    "granting should carry straight on through the device flow"
  );
});

test("refusing the host permission explains it instead of failing silently", async () => {
  const browser = mockBrowser({}, { grantHost: false });
  const fetch = mockFetch([{ body: {} }]);
  const dom = await loadPage("sidebar/panel.html", { browser, fetch });
  await settle();

  clickConnect(dom);
  await settle();

  assert.equal(fetch.requests.length, 0, "no request may go out without the permission");
  assert.match(dom.window.document.body.textContent, /needs permission to reach github\.com\/login/);
  assert.match(dom.window.document.body.textContent, /Press Connect again/);
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

const PR_URL = "https://github.com/example-org/example-repo/pull/41";

test("clicking a link already open in another tab focuses it instead of duplicating it", async () => {
  const browser = mockBrowser(SIGNED_IN, {
    tabs: [{ id: 77, windowId: 9, url: PR_URL }],
  });
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  dom.window.document.querySelector(".row .open").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await settle();

  assert.equal(browser.calls.tabs.length, 0, "no duplicate tab should be created");
  assert.equal(browser.calls.tabUpdates.length, 1);
  assert.deepEqual(browser.calls.tabUpdates[0], { id: 77, active: true });

  // The matching tab may be in another window, so that window must be
  // brought to the front too.
  assert.equal(browser.calls.windowUpdates.length, 1);
  assert.deepEqual(browser.calls.windowUpdates[0], { id: 9, focused: true });
});

test("clicking a link with no matching open tab opens a new one, as before", async () => {
  const browser = mockBrowser(SIGNED_IN, {
    tabs: [{ id: 1, windowId: 1, url: "https://github.com/example-org/example-repo/pull/999" }],
  });
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  dom.window.document.querySelector(".row .open").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await settle();

  assert.equal(browser.calls.tabs.length, 1);
  assert.equal(browser.calls.tabs[0].url, PR_URL);
  assert.equal(browser.calls.tabs[0].active, true);
  assert.equal(browser.calls.tabUpdates.length, 0);
  assert.equal(browser.calls.windowUpdates.length, 0);
});

test("ctrl-click always opens a new background tab, even when a matching tab exists", async () => {
  const browser = mockBrowser(SIGNED_IN, {
    tabs: [{ id: 77, windowId: 9, url: PR_URL }],
  });
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  dom.window.document.querySelector(".row .open").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })
  );
  await settle();

  assert.equal(browser.calls.tabs.length, 1, "a modifier click always creates a tab");
  assert.equal(browser.calls.tabs[0].active, false, "and it goes to the background");
  assert.equal(browser.calls.tabUpdates.length, 0, "the existing match must not be hijacked");
  assert.equal(browser.calls.windowUpdates.length, 0);
});

test("a match differing only by URL fragment still counts as the same tab", async () => {
  const browser = mockBrowser(SIGNED_IN, {
    tabs: [{ id: 5, windowId: 1, url: `${PR_URL}#issuecomment-123` }],
  });
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  dom.window.document.querySelector(".row .open").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await settle();

  assert.equal(browser.calls.tabs.length, 0, "the fragment-only difference is still a match");
  assert.deepEqual(browser.calls.tabUpdates[0], { id: 5, active: true });
});

test("a browser.tabs.query failure degrades to opening a new tab rather than a no-op", async () => {
  const browser = mockBrowser(SIGNED_IN, {
    tabs: [{ id: 77, windowId: 9, url: PR_URL }],
  });
  browser.api.tabs.query = async () => {
    throw new Error("Missing host permission for the tab");
  };
  const dom = await loadPage("sidebar/panel.html", {
    browser,
    fetch: mockFetch([fixture("search")]),
  });
  await settle();

  dom.window.document.querySelector(".row .open").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await settle();

  assert.equal(browser.calls.tabs.length, 1, "the click must still open something");
  assert.equal(browser.calls.tabs[0].url, PR_URL);
  assert.equal(browser.calls.tabUpdates.length, 0);
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
  // The path is the actionable half: it names the field the App was refused,
  // which is what identifies the missing permission.
  assert.match(status.textContent, /partial at search\.nodes\.statusCheckRollup/);
  assert.match(status.textContent, /Resource not accessible by integration/);
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

test("re-run checks are deduped and failures sort first", async () => {
  // A busy PR carries the same check name many times (one per re-run) and can
  // have 60+ contexts; the detail view is useless if it shows stale duplicates
  // or buries the one red check under fifty green ones.
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

  const names = [...dom.window.document.querySelectorAll(".check-runs .check")]
    .map((n) => n.textContent);
  assert.equal(names.length, 3, "two runs named `unit` should collapse to one");

  const tones = [...dom.window.document.querySelectorAll(".check-runs .check .dot")]
    .map((n) => n.className.replace("dot ", ""));
  // `unit` failed and was re-run green, so only `lint` is still failing. That
  // the re-run wins is the point: a fixed check must not keep showing red.
  assert.deepEqual(tones, ["bad", "ok", "ok"], "failures must come first");

  // The kept `unit` entry is the later run (runs/9), not the earlier one.
  const unitLink = [...dom.window.document.querySelectorAll(".check-runs .check a")]
    .find((a) => a.textContent === "unit");
  assert.match(unitLink.href, /runs\/9$/, "the latest run must win, not the first");
  assert.match(dom.window.document.body.textContent, /Checks \(3\)/);
});

test("the detail view renders the body as markdown, not flat text", async () => {
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

  const body = dom.window.document.querySelector(".markdown");
  assert.ok(body, "the description should render through the markdown pipeline");
  assert.equal(body.querySelectorAll("strong").length, 1);
  assert.equal(body.querySelectorAll("pre code").length, 1, "code fences survive");
  assert.ok(body.querySelectorAll("li").length >= 2, "list items survive");

  // Relative links in a PR body must point back at github.com, not at the
  // extension's own origin.
  assert.equal(
    body.querySelector("a").getAttribute("href"),
    "https://github.com/example-org/example-repo/issues/39"
  );

  // And the comment bodies go through the same path.
  assert.ok(dom.window.document.querySelectorAll(".comment .markdown em").length >= 1);
});

test("exactly one query ships by default, and it is the involves view", async () => {
  const dom = await loadPage("sidebar/panel.html", { browser: mockBrowser() });
  const defaults = dom.window.GV.DEFAULT_QUERIES;

  assert.equal(defaults.length, 1, "one default, on purpose");
  const [only] = defaults;
  assert.equal(only.id, "my-open-prs");
  assert.equal(only.name, "My PRs");
  assert.equal(only.variables.q, "is:pr state:open involves:@me archived:false");
  assert.equal(only.list, "search.nodes");
  assert.equal(only.count, "search.issueCount");

  // involves:@me is the whole point - GraphQL search has no OR, so the
  // disjunction has to come from the qualifier itself.
  assert.doesNotMatch(only.variables.q, /\bOR\b/);
  assert.match(only.document, /statusCheckRollup \{ state \}/,
    "the CI chip is why this stays on GraphQL rather than REST");
  assert.doesNotMatch(only.document, /commits\(last/,
    "must not reintroduce the Contents-permission traversal");
});

test("comment counts are pluralised correctly", async () => {
  const one = JSON.parse(JSON.stringify(fixture("search")));
  one.data.search.nodes[0].comments.totalCount = 1;
  one.data.search.nodes[1].comments.totalCount = 3;
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser(SIGNED_IN),
    fetch: mockFetch([one]),
  });
  await settle();

  const counts = [...dom.window.document.querySelectorAll(".row .comments")]
    .map((n) => n.textContent);
  assert.ok(counts.includes("1 comment"), `expected a singular, got ${counts.join(" | ")}`);
  assert.ok(counts.includes("3 comments"));
});
