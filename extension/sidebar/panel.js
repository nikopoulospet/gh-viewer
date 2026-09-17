"use strict";

const view = document.getElementById("view");
const statusBar = document.getElementById("status");
const select = document.getElementById("query-select");
const backButton = document.getElementById("back");

let queries = [];
let currentQuery = null;
let abortDeviceFlow = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

// GraphQL reports a permission gap as an error naming the exact field that was
// refused, in `path`. Without it "Resource not accessible by integration" gives
// no clue which permission is missing, so the path is what makes it actionable.
function describeErrors(errors) {
  console.warn("gh-viewer: partial GraphQL response", errors);
  const first = errors[0];
  const path = Array.isArray(first.path)
    ? first.path.filter((part) => typeof part !== "number").join(".")
    : "";
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
  return `partial${path ? ` at ${path}` : ""}: ${first.message}${more}`;
}

// REST issue search understands the boolean syntax the GraphQL API does not,
// so `(assignee:@me OR author:@me)` is expressible in one request. The response
// is normalised into the same node shape GraphQL returns.
async function runRestSearch(query) {
  const body = await GV.api.rest("/search/issues", {
    ...query.variables,
    advanced_search: "true",
  });
  return { data: GV.fromRestSearch(body), errors: null };
}

// GitHub's GraphQL search API has no boolean operators: `a OR b` and parentheses are
// treated as literal search terms, so a query using them matches nothing and
// returns a silent zero rather than an error. Recognise that specific shape and
// say so, instead of letting it read as "you have no open PRs".
function unsupportedBooleanHint(query) {
  if (query?.kind === "rest-search") return null; // REST search supports them
  const values = Object.values(query?.variables || {}).filter((v) => typeof v === "string");
  const offender = values.find((v) => /\bOR\b|\bAND\b|\bNOT\b|[()]/.test(v));
  if (!offender) return null;
  return (
    "This search uses OR/AND or parentheses, which GitHub's search API does " +
    "not support — it matches them as literal text, so nothing is found. " +
    "Split it into two searches and list both paths instead."
  );
}

function setStatus(text, tone) {
  statusBar.textContent = text || "";
  statusBar.className = tone || "";
}

function show(node, { back = false } = {}) {
  view.replaceChildren(node);
  backButton.hidden = !back;
  select.hidden = back;
}

// --- links focus an existing tab, or open a new one ----------------------
// The sidebar is a fixed workspace; nothing navigates it away. A plain click
// reuses a tab already open at that URL instead of piling up duplicates. A
// modifier (middle-click, ctrl/cmd/shift-click) is an explicit request for a
// new background tab, so it always gets one, even if a match exists.
document.addEventListener("click", (event) => {
  const anchor = event.target.closest?.("a[href]");
  if (!anchor || !/^https?:/i.test(anchor.href)) return;
  event.preventDefault();
  event.stopPropagation();
  const background = event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey;
  openLink(anchor.href, background);
});

// Finds a tab already open at `url`: an exact match first, falling back to
// one that differs only by URL fragment (so a PR link and the same PR
// scrolled to a comment count as the same page). The query string is never
// ignored - GitHub search URLs differ meaningfully by query.
//
// `tabs.query` needs the `tabs` permission; if it throws (or is missing) a
// click must still open something rather than silently doing nothing.
async function findOpenTab(url) {
  try {
    const tabs = await browser.tabs.query({});
    const exact = tabs.find((t) => t.url === url);
    if (exact) return exact;
    const withoutFragment = url.split("#")[0];
    return tabs.find((t) => t.url && t.url.split("#")[0] === withoutFragment) || null;
  } catch (e) {
    console.warn("gh-viewer: tabs.query failed, opening a new tab", e);
    return null;
  }
}

async function openLink(url, background) {
  if (!background) {
    const existing = await findOpenTab(url);
    if (existing) {
      await browser.tabs.update(existing.id, { active: true });
      await browser.windows.update(existing.windowId, { focused: true });
      return;
    }
  }
  browser.tabs.create({ url, active: !background });
}

document.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.target.closest?.("a[href]") && event.preventDefault();
});

// --- first-run: the App's client id -------------------------------------

function showSetup(message) {
  const wrap = el("div", "pane");
  wrap.append(el("h2", null, "Use a different App"));
  wrap.append(el("p", "muted",
    "gh-viewer already knows its own App. Paste another App's Client ID here " +
    "only if you are testing against one you registered yourself. Leave it " +
    "empty to go back to the built-in App."));
  if (message) wrap.append(el("p", "error", message));

  const input = el("input");
  input.type = "text";
  input.placeholder = "Iv23li...";
  input.autocomplete = "off";
  wrap.append(input);

  const save = el("button", "primary", "Save Client ID");
  save.addEventListener("click", async () => {
    if (!input.value.trim()) return;
    await GV.store.setClientId(input.value);
    boot();
  });
  wrap.append(save);
  show(wrap);
}

// --- device flow ---------------------------------------------------------

function showConnect(message) {
  const wrap = el("div", "pane");
  wrap.append(el("h2", null, "Sign in to GitHub"));
  wrap.append(el("p", "muted",
    "GitHub will show a one-time code to approve in a browser tab. " +
    "gh-viewer stores only the resulting read-only token."));

  const install = el("p", "muted");
  install.append(document.createTextNode("Seeing nothing after you connect? The App also has to be "));
  const installLink = el("a", null, "installed on the account or org");
  installLink.href = GV.INSTALL_URL;
  install.append(installLink, document.createTextNode(" that owns the repos."));
  wrap.append(install);
  if (message) wrap.append(el("p", "error", message));

  const connect = el("button", "primary", "Connect");
  connect.addEventListener("click", startDeviceFlow);
  wrap.append(connect);

  const reset = el("button", "link", "Use a different Client ID");
  reset.addEventListener("click", () => showSetup());
  wrap.append(reset);
  show(wrap);
}

async function startDeviceFlow() {
  const clientId = await GV.store.getClientId();
  setStatus("asking GitHub for a code…");
  let device;
  try {
    device = await GV.auth.requestDeviceCode(clientId);
  } catch (e) {
    setStatus("");
    return showConnect(e.message);
  }

  const wrap = el("div", "pane");
  wrap.append(el("h2", null, "Enter this code on GitHub"));

  const code = el("div", "code", device.user_code);
  code.title = "Click to copy";
  code.addEventListener("click", () => {
    navigator.clipboard.writeText(device.user_code).then(() => setStatus("code copied"));
  });
  wrap.append(code);

  const open = el("a", "primary-link", "Open GitHub to approve ↗");
  open.href = device.verification_uri;
  wrap.append(open);

  const waiting = el("p", "muted", "Waiting for approval…");
  wrap.append(waiting);

  const cancel = el("button", "link", "Cancel");
  const controller = new AbortController();
  abortDeviceFlow = controller;
  cancel.addEventListener("click", () => {
    controller.abort();
    showConnect();
  });
  wrap.append(cancel);
  show(wrap);

  try {
    const grant = await GV.auth.pollForToken(clientId, device, {
      signal: controller.signal,
      onWait: (secondsLeft) => {
        waiting.textContent = `Waiting for approval… (${secondsLeft}s left)`;
      },
    });
    await GV.store.setToken(grant.access_token);
    const viewer = await GV.api.whoAmI(grant.access_token);
    if (viewer) await GV.store.setViewer(viewer);

    if (grant.expires_in) {
      // Refreshing needs a client secret, which a browser extension cannot
      // hold, so this token simply dies. Say so now, with the fix.
      const hours = Math.round(grant.expires_in / 3600);
      setStatus(
        `signed in, but this token expires in ~${hours}h — turn off ` +
        `"Expire user authorization tokens" in the App settings`,
        "warn"
      );
    } else {
      setStatus(viewer ? `signed in as ${viewer.login}` : "signed in");
    }
    boot();
  } catch (e) {
    if (e.message !== "cancelled") showConnect(e.message);
  } finally {
    abortDeviceFlow = null;
  }
}

// --- running saved queries ----------------------------------------------

async function runSelected() {
  const query = queries.find((q) => q.id === select.value) || queries[0];
  currentQuery = query;
  if (!query) {
    return show(el("div", "pane", "No saved queries. Add one in settings (⚙)."));
  }
  await GV.store.setSelectedQueryId(query.id);

  show(el("div", "pane muted", "Loading…"));
  setStatus("querying GitHub…");

  let response;
  try {
    response = query.kind === "rest-search"
      ? await runRestSearch(query)
      : await GV.api.graphql(query.document, query.variables);
  } catch (e) {
    setStatus("");
    if (e instanceof GV.AuthError) return showConnect(e.message);
    return show(el("div", "pane error", e.message));
  }

  const nodes = GV.collect(response.data, query.list);
  const total = GV.total(response.data, query.count);
  const remaining = response.data?.rateLimit?.remaining;

  if (!nodes.length) {
    show(el("div", "pane muted", unsupportedBooleanHint(query) || "Nothing matched this query."));
  } else {
    show(GV.render.list(nodes));
  }

  const parts = [];
  if (total != null) parts.push(`${nodes.length} of ${total}`);
  if (remaining != null) parts.push(`${remaining} API points left`);
  setStatus(parts.join(" · "));

  // A field the App lacks permission for comes back null with an error while
  // everything else renders - say so rather than showing a silent gap.
  if (response.errors?.length) {
    setStatus(`${parts.join(" · ")} — ${describeErrors(response.errors)}`.slice(0, 200), "warn");
  }
}

// --- drill-down ----------------------------------------------------------

view.addEventListener("click", async (event) => {
  const row = event.target.closest?.(".row");
  if (!row || !row.dataset.id) return;
  if (event.target.closest("a")) return; // the ↗ link handles itself
  openDetail(row.dataset.id);
});

async function openDetail(id) {
  show(el("div", "pane muted", "Loading…"), { back: true });
  setStatus("querying GitHub…");
  try {
    const { data, errors } = await GV.api.graphql(GV.DETAIL_DOC, { id });
    if (!data?.node) throw new Error(errors?.[0]?.message || "not found");
    show(GV.render.detail(data.node, currentQuery?.detail || {}), { back: true });
    setStatus(errors?.length ? describeErrors(errors) : "", errors?.length ? "warn" : "");
  } catch (e) {
    if (e instanceof GV.AuthError) return showConnect(e.message);
    show(el("div", "pane error", e.message), { back: true });
    setStatus("");
  }
}

backButton.addEventListener("click", runSelected);
document.getElementById("refresh").addEventListener("click", runSelected);
document.getElementById("settings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});
select.addEventListener("change", runSelected);

// --- boot ----------------------------------------------------------------

async function boot() {
  abortDeviceFlow?.abort();
  const clientId = await GV.store.getClientId();
  if (!clientId) return showSetup();
  if (!(await GV.store.getToken())) return showConnect();

  queries = await GV.store.getQueries();
  const selected = await GV.store.getSelectedQueryId();
  select.replaceChildren(...queries.map((q) => {
    const option = document.createElement("option");
    option.value = q.id;
    option.textContent = q.name;
    return option;
  }));
  if (queries.some((q) => q.id === selected)) select.value = selected;
  runSelected();
}

// Queries edited in the options page show up without reopening the sidebar.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.queries) boot();
});

boot();
