"use strict";

const list = document.getElementById("queries");
const statusLine = document.getElementById("status");
const clientInput = document.getElementById("client-id");
const fileInput = document.getElementById("file");

let queries = [];

function say(text, tone) {
  statusLine.textContent = text;
  statusLine.className = tone || "muted";
}

function field(labelText, value, className, rows) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  const area = document.createElement(rows ? "textarea" : "input");
  if (!rows) area.type = "text";
  area.className = className;
  area.value = value ?? "";
  wrap.append(area);
  return { wrap, area };
}

function card(query) {
  const root = document.createElement("div");
  root.className = "card";

  const head = document.createElement("div");
  head.className = "card-head";
  const name = document.createElement("input");
  name.type = "text";
  name.value = query.name || "";
  name.placeholder = "Query name";
  head.append(name);

  const remove = document.createElement("button");
  remove.className = "danger";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => {
    queries = queries.filter((q) => q !== query);
    draw();
    say("deleted — press Save all to keep it that way");
  });
  head.append(remove);
  root.append(head);

  const doc = field("GraphQL document", query.document, "doc", true);
  root.append(doc.wrap);

  const vars = field("Variables (JSON)", JSON.stringify(query.variables ?? {}, null, 2), "vars", true);
  root.append(vars.wrap);

  const grid = document.createElement("div");
  grid.className = "grid";
  const listPath = field("List path", query.list, "path");
  const countPath = field("Count path", query.count, "path");
  grid.append(listPath.wrap, countPath.wrap);
  root.append(grid);

  // Variables are JSON, so validate as the user types rather than at save time.
  vars.area.addEventListener("input", () => {
    try {
      JSON.parse(vars.area.value || "{}");
      vars.area.classList.remove("invalid");
    } catch {
      vars.area.classList.add("invalid");
    }
  });

  root.collect = () => {
    let parsedVars;
    try {
      parsedVars = JSON.parse(vars.area.value || "{}");
    } catch (e) {
      throw new Error(`"${name.value || query.id}": variables are not valid JSON`);
    }
    return {
      id: query.id,
      name: name.value.trim() || "Untitled",
      document: doc.area.value,
      variables: parsedVars,
      list: listPath.area.value.trim(),
      count: countPath.area.value.trim(),
    };
  };

  return root;
}

function draw() {
  list.replaceChildren(...queries.map(card));
}

document.getElementById("add").addEventListener("click", () => {
  queries.push({
    id: `q-${Date.now().toString(36)}`,
    name: "New query",
    document: GV.SEARCH_DOC,
    variables: { q: "is:pr state:open assignee:@me archived:false", first: 30 },
    list: "search.nodes",
    count: "search.issueCount",
  });
  draw();
  say("added — press Save all to keep it");
});

document.getElementById("save").addEventListener("click", async () => {
  try {
    const collected = Array.from(list.children).map((c) => c.collect());
    await GV.store.saveQueries(collected);
    queries = collected;
    say(`saved ${collected.length} queries`, "ok");
  } catch (e) {
    say(e.message, "bad");
  }
});

document.getElementById("reset").addEventListener("click", async () => {
  queries = JSON.parse(JSON.stringify(GV.DEFAULT_QUERIES));
  await GV.store.saveQueries(queries);
  draw();
  say("reset to defaults", "ok");
});

document.getElementById("export").addEventListener("click", () => {
  // The sandbox blocks downloads started by the page, so hand over text the
  // user can copy instead of a file that silently never arrives.
  const blob = JSON.stringify(queries, null, 2);
  navigator.clipboard.writeText(blob).then(
    () => say("queries copied to the clipboard as JSON", "ok"),
    () => say("could not reach the clipboard", "bad")
  );
});

document.getElementById("import").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array of queries");
    queries = parsed;
    await GV.store.saveQueries(queries);
    draw();
    say(`imported ${queries.length} queries`, "ok");
  } catch (e) {
    say(`import failed: ${e.message}`, "bad");
  }
  fileInput.value = "";
});

document.getElementById("save-client").addEventListener("click", async () => {
  await GV.store.setClientId(clientInput.value);
  say("client ID saved", "ok");
});

document.getElementById("sign-out").addEventListener("click", async () => {
  await GV.store.clearToken();
  say("signed out — the sidebar will ask you to reconnect", "ok");
  showAccount();
});

async function showAccount() {
  const viewer = await GV.store.getViewer();
  const token = await GV.store.getToken();
  document.getElementById("account").textContent = token
    ? `Signed in as ${viewer?.login || "(unknown)"}.`
    : "Not signed in.";
}

// --- tabs ----------------------------------------------------------------

const tabs = [...document.querySelectorAll(".tab")];
const panels = new Map(
  tabs.map((tab) => [tab.dataset.tab, document.getElementById(`tab-${tab.dataset.tab}`)])
);

function selectTab(name) {
  for (const tab of tabs) {
    const active = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(active));
    panels.get(tab.dataset.tab).hidden = !active;
  }
  // Survives a reload, so a report is still in view after you come back to it.
  location.hash = name;
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
}

// --- access ---------------------------------------------------------------

const accessBox = document.getElementById("access");
const accessStatus = document.getElementById("access-status");

function sayAccess(text, tone) {
  accessStatus.textContent = text;
  accessStatus.className = tone || "muted";
}

// Nothing from GitHub is inserted as HTML - repository and account names are
// untrusted input like any other.
function accessCard(entry) {
  const wrap = document.createElement("div");
  wrap.className = "access-card";

  const head = document.createElement("h3");
  head.textContent = entry.account;
  if (entry.type) {
    const kind = document.createElement("span");
    kind.className = "chip";
    kind.textContent = entry.type === "Organization" ? "org" : "personal";
    head.append(" ", kind);
  }
  wrap.append(head);

  if (entry.error) {
    const failed = document.createElement("p");
    failed.className = "bad";
    failed.textContent = `could not list repositories: ${entry.error}`;
    wrap.append(failed);
    return wrap;
  }

  const summary = document.createElement("p");
  summary.className = "muted";
  const count = entry.repositories.length;
  summary.textContent = entry.everyRepository
    ? `All repositories (${count}), including any created later.`
    : `${count} selected repositor${count === 1 ? "y" : "ies"}.`;
  wrap.append(summary);

  const list = document.createElement("ul");
  list.className = "repo-list";
  for (const repo of entry.repositories) {
    const item = document.createElement("li");
    item.textContent = repo.name;
    if (repo.private) {
      const tag = document.createElement("span");
      tag.className = "chip";
      tag.textContent = "private";
      item.append(" ", tag);
    }
    list.append(item);
  }
  wrap.append(list);

  if (entry.truncated) {
    const more = document.createElement("p");
    more.className = "muted";
    more.textContent = "…and more; the list was cut off.";
    wrap.append(more);
  }
  return wrap;
}

document.getElementById("check-access").addEventListener("click", async () => {
  sayAccess("asking GitHub…");
  accessBox.replaceChildren();
  try {
    const entries = await GV.access.list();
    if (!entries.length) {
      // Not an error, and not "nothing works": public repositories and your own
      // are readable without any installation. What is missing is organisations.
      sayAccess("Not installed on any organisation yet. Public repositories and "
                + "your own still work; an organisation's private ones need the "
                + "step below.");
      return;
    }
    accessBox.replaceChildren(...entries.map(accessCard));
    const repos = entries.reduce((n, e) => n + e.repositories.length, 0);
    sayAccess(`${entries.length} installation${entries.length === 1 ? "" : "s"}, `
              + `${repos} repositor${repos === 1 ? "y" : "ies"}.`, "ok");
  } catch (e) {
    sayAccess(`could not check access: ${e.message}`, "bad");
  }
});

// --- diagnostics ---------------------------------------------------------

const reportBox = document.getElementById("report");
const diagnosticsStatus = document.getElementById("diagnostics-status");
let lastReport = "";

function sayDiagnostics(text, tone) {
  diagnosticsStatus.textContent = text;
  diagnosticsStatus.className = tone || "muted";
}

document.getElementById("generate").addEventListener("click", async () => {
  const probe = document.getElementById("probe").checked;
  sayDiagnostics(probe ? "collecting state and querying GitHub…" : "collecting state…");
  try {
    const report = await GV.diagnostics.collect({ probe });
    lastReport = GV.diagnostics.toText(report);
    reportBox.textContent = lastReport;
    reportBox.hidden = false;
    const failed = (report.probe || []).filter((r) => !r.ok).length;
    sayDiagnostics(
      failed ? `report ready — ${failed} quer${failed === 1 ? "y" : "ies"} reported problems`
             : "report ready",
      failed ? "bad" : "ok"
    );
  } catch (e) {
    sayDiagnostics(`could not build the report: ${e.message}`, "bad");
  }
});

document.getElementById("copy").addEventListener("click", async () => {
  if (!lastReport) return sayDiagnostics("generate a report first", "bad");
  try {
    await navigator.clipboard.writeText(lastReport);
    sayDiagnostics("report copied to the clipboard", "ok");
  } catch {
    sayDiagnostics("could not reach the clipboard — select the text and copy it", "bad");
  }
});

(async function boot() {
  const requested = location.hash.replace("#", "");
  selectTab(panels.has(requested) ? requested : "queries");

  document.getElementById("install-link").href = GV.INSTALL_URL;
  clientInput.value = await GV.store.getClientId();
  queries = await GV.store.getQueries();
  draw();
  showAccount();
})();
