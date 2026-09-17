import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage, mockBrowser, mockFetch, fixture, settle } from "../harness.mjs";

const SIGNED_IN = {
  token: "ghu_supersecrettokenvalue12345",
  viewer: { login: "octocat" },
  clientId: "",
};

async function optionsPage(state, fetch) {
  const dom = await loadPage("options/options.html", {
    browser: mockBrowser(state),
    fetch,
  });
  await settle();
  return dom;
}

test("the report never contains the access token", async () => {
  // The whole point of this export is that it is safe to paste into an issue.
  const dom = await optionsPage(SIGNED_IN);
  const report = await dom.window.GV.diagnostics.collect();
  const text = dom.window.GV.diagnostics.toText(report);

  assert.doesNotMatch(text, /supersecrettokenvalue/, "the token must not appear");
  assert.equal(report.session.token.value, "<redacted>");
  assert.equal(report.session.signedIn, true);
  assert.equal(report.session.token.kind, "ghu_…", "the credential type is still reported");
  assert.equal(report.session.token.length, SIGNED_IN.token.length);
});

test("a signed-out state reports cleanly rather than inventing a token", async () => {
  const dom = await optionsPage({});
  const report = await dom.window.GV.diagnostics.collect();
  assert.equal(report.session.signedIn, false);
  assert.equal(report.session.token.present, false);
  assert.equal(report.session.viewer, null);
});

test("the report captures configuration worth debugging", async () => {
  const dom = await optionsPage(SIGNED_IN);
  const report = await dom.window.GV.diagnostics.collect();

  assert.equal(report.extension.name, "gh-viewer");
  assert.ok(report.extension.version, "version helps identify the build");
  assert.ok(Array.isArray(report.extension.permissions));
  assert.ok(report.app.clientId, "which App is in use");
  assert.equal(report.app.usingBuiltInClientId, true);
  assert.equal(report.storage.usingDefaultQueries, true);
  assert.ok(report.queries.length >= 4, "saved queries travel with the report");
  assert.ok(report.queries[0].document, "including the document that may be broken");
  assert.ok(report.generatedAt);
});

test("probing records per-query errors without leaking row content", async () => {
  // partial.json is a FORBIDDEN permission error alongside real data - exactly
  // the case a user would be trying to report.
  const dom = await optionsPage(
    { ...SIGNED_IN, queries: [{
      id: "q1", name: "Broken one", document: "query { x }", variables: {},
      list: "search.nodes", count: "search.issueCount",
    }] },
    mockFetch([fixture("partial")])
  );

  const report = await dom.window.GV.diagnostics.collect({ probe: true });
  const [result] = report.probe;

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].message, "Resource not accessible by integration");
  // The report keeps the array index, unlike the sidebar status bar which
  // strips it for readability: in a bug report, knowing WHICH row was refused
  // is worth the extra noise.
  assert.equal(result.errors[0].path, "search.nodes.0.statusCheckRollup",
    "the refused field is what identifies the missing permission");
  assert.equal(result.rows, 1, "row counts are reported");

  // Titles and URLs must not ride along into a report destined for an issue.
  const text = dom.window.GV.diagnostics.toText(report);
  assert.doesNotMatch(text, /A PR whose checks/, "row content must stay out");
});

test("the options page exposes a diagnostics tab", async () => {
  const dom = await optionsPage({});
  const names = [...dom.window.document.querySelectorAll(".tab")]
    .map((t) => t.dataset.tab);
  assert.deepEqual(Array.from(names), ["queries", "connection", "diagnostics"]);

  const diagnostics = dom.window.document.getElementById("tab-diagnostics");
  assert.equal(diagnostics.hidden, true, "queries tab shows first");

  dom.window.document.querySelector('[data-tab="diagnostics"]')
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await settle();
  assert.equal(diagnostics.hidden, false);
  assert.equal(dom.window.document.getElementById("tab-queries").hidden, true);
});
