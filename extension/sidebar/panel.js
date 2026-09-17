"use strict";

const view = document.getElementById("view");
const statusBar = document.getElementById("status");
const select = document.getElementById("query-select");
const backButton = document.getElementById("back");

let queries = [];
let abortDeviceFlow = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
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

// --- links always open in a new tab -------------------------------------
// The sidebar is a fixed workspace; nothing navigates it away.
document.addEventListener("click", (event) => {
  const anchor = event.target.closest?.("a[href]");
  if (!anchor || !/^https?:/i.test(anchor.href)) return;
  event.preventDefault();
  event.stopPropagation();
  const background = event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey;
  browser.tabs.create({ url: anchor.href, active: !background });
});

document.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.target.closest?.("a[href]") && event.preventDefault();
});

// --- first-run: the App's client id -------------------------------------

function showSetup(message) {
  const wrap = el("div", "pane");
  wrap.append(el("h2", null, "Connect gh-viewer"));
  wrap.append(el("p", "muted",
    "Register the GitHub App once, then paste its Client ID here. " +
    "Run tools/register_app.py in the repo - it prints the ID and writes app.json."));
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
    const token = await GV.auth.pollForToken(clientId, device, {
      signal: controller.signal,
      onWait: (secondsLeft) => {
        waiting.textContent = `Waiting for approval… (${secondsLeft}s left)`;
      },
    });
    await GV.store.setToken(token);
    const viewer = await GV.api.whoAmI(token);
    if (viewer) await GV.store.setViewer(viewer);
    setStatus(viewer ? `signed in as ${viewer.login}` : "signed in");
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
  if (!query) {
    return show(el("div", "pane", "No saved queries. Add one in settings (⚙)."));
  }
  await GV.store.setSelectedQueryId(query.id);

  show(el("div", "pane muted", "Loading…"));
  setStatus("querying GitHub…");

  let response;
  try {
    response = await GV.api.graphql(query.document, query.variables);
  } catch (e) {
    setStatus("");
    if (e instanceof GV.AuthError) return showConnect(e.message);
    return show(el("div", "pane error", e.message));
  }

  const nodes = GV.pluck(response.data, query.list) || [];
  const total = GV.pluck(response.data, query.count);
  const remaining = response.data?.rateLimit?.remaining;

  if (!nodes.length) {
    show(el("div", "pane muted", "Nothing matched this query."));
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
    const first = response.errors[0];
    setStatus(`${parts.join(" · ")} — partial: ${first.message}`.slice(0, 200), "warn");
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
    show(GV.render.detail(data.node), { back: true });
    setStatus(errors?.length ? `partial: ${errors[0].message}` : "", errors?.length ? "warn" : "");
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
