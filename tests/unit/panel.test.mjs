import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage, mockBrowser, mockFetch, fixture, settle } from "../harness.mjs";

const SIGNED_IN = { token: "ghu_test", viewer: { login: "octocat" } };

// Tests that feed the `search.json` fixture pin their own query rather than
// relying on whichever default happens to sort first - otherwise adding a
// default view breaks unrelated tests.
const SIMPLE_QUERY = {
  id: "simple",
  name: "Simple search",
  document: "query { x }",
  variables: {},
  list: "search.nodes",
  count: "search.issueCount",
};
const SIGNED_IN_SIMPLE = { ...SIGNED_IN, queries: [SIMPLE_QUERY] };

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
    browser: mockBrowser(SIGNED_IN_SIMPLE),
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
    browser: mockBrowser(SIGNED_IN_SIMPLE),
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE);
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE);
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE, {
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE, {
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE, {
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE, {
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE, {
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
    browser: mockBrowser(SIGNED_IN_SIMPLE),
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
  const browser = mockBrowser(SIGNED_IN_SIMPLE);
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
    browser: mockBrowser(SIGNED_IN_SIMPLE),
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
    browser: mockBrowser(SIGNED_IN_SIMPLE),
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

test("a view can merge two searches and dedupe the overlap", async () => {
  // GitHub search has no OR between qualifiers, so "assigned or opened" runs as
  // two aliased searches. The fixture puts one PR in both.
  const dom = await loadPage("sidebar/panel.html", { browser: mockBrowser(SIGNED_IN_SIMPLE) });
  await settle();
  const { GV } = dom.window;
  const data = fixture("mine").data;

  const nodes = GV.collect(data, ["assigned.nodes", "authored.nodes"]);
  assert.equal(nodes.length, 3, "four rows across two searches, one shared");
  assert.ok(Array.isArray(nodes));
  assert.equal(new Set(nodes.map((n) => n.id)).size, 3, "ids must be unique");

  // The raw total may exceed what is rendered, because the searches overlap.
  assert.equal(GV.total(data, ["assigned.issueCount", "authored.issueCount"]), 4);
  assert.equal(GV.total(data, "assigned.issueCount"), 2, "a single path still works");
});

test("a query can limit the drill-in to just the description", async () => {
  const queries = [{
    id: "only-body",
    name: "Only the body",
    document: "query { x }",
    variables: {},
    list: "search.nodes",
    count: "search.issueCount",
    detail: { sections: ["description"] },
  }];
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser({ ...SIGNED_IN, queries }),
    fetch: mockFetch([fixture("search"), fixture("detail")]),
  });
  await settle();
  dom.window.document.querySelector(".row").dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true })
  );
  await settle();

  const body = dom.window.document.body.textContent;
  assert.ok(dom.window.document.querySelector(".markdown"), "description renders");
  assert.doesNotMatch(body, /Checks \(/, "checks section suppressed");
  assert.doesNotMatch(body, /Reviews/, "reviews section suppressed");
  assert.equal(dom.window.document.querySelectorAll(".comment").length, 0,
    "comments suppressed");

  // Identity and the way out are never suppressed.
  assert.match(body, /Retry flaky uploads/);
  assert.ok([...dom.window.document.querySelectorAll("a")]
    .some((a) => a.href.includes("/pull/41")), "the GitHub link survives");
});

test("the default set includes the merged mine view", async () => {
  const dom = await loadPage("sidebar/panel.html", { browser: mockBrowser() });
  const mine = dom.window.GV.DEFAULT_QUERIES.find((q) => q.id === "my-prs");
  assert.ok(mine, "expected a my-prs default");
  assert.deepEqual(Array.from(mine.list), ["assigned.nodes", "authored.nodes"]);
  assert.deepEqual(Array.from(mine.detail.sections), ["description"]);
  assert.match(mine.variables.assigned, /assignee:@me/);
  assert.match(mine.variables.authored, /author:@me/);
  assert.match(mine.variables.assigned, /is:open/, "is:open already includes drafts");
});

test("a search using OR explains itself instead of reading as 'no results'", async () => {
  // GitHub's search API matches OR and parentheses as literal text, so such a
  // query silently returns zero. That is indistinguishable from "you have no
  // open PRs" unless the panel says otherwise.
  const empty = { data: { rateLimit: { remaining: 10 }, search: { issueCount: 0, nodes: [] } } };
  const queries = [{
    id: "boolean", name: "Boolean attempt", document: "query { x }",
    variables: { q: "is:pr state:open (assignee:@me OR author:@me) archived:false" },
    list: "search.nodes", count: "search.issueCount",
  }];
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser({ ...SIGNED_IN, queries }),
    fetch: mockFetch([empty]),
  });
  await settle();

  const body = dom.window.document.body.textContent;
  assert.match(body, /does not support/);
  assert.match(body, /Split it into two searches/);
  assert.doesNotMatch(body, /^Nothing matched this query\.$/);
});

test("an ordinary empty result still reads as empty", async () => {
  const empty = { data: { rateLimit: { remaining: 10 }, search: { issueCount: 0, nodes: [] } } };
  const dom = await loadPage("sidebar/panel.html", {
    browser: mockBrowser(SIGNED_IN_SIMPLE),
    fetch: mockFetch([empty]),
  });
  await settle();
  assert.match(dom.window.document.body.textContent, /Nothing matched this query/);
});
