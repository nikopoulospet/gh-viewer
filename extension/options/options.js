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
  // Several comma-separated paths are merged and deduped, which is how one
  // view combines two searches.
  const listPath = field("List path(s)", [].concat(query.list || "").join(", "), "path");
  const countPath = field("Count path(s)", [].concat(query.count || "").join(", "), "path");
  grid.append(listPath.wrap, countPath.wrap);
  root.append(grid);

  const sections = field(
    "Detail sections (blank = all: chips, checks, reviews, description, comments)",
    (query.detail?.sections || []).join(", "),
    "path"
  );
  root.append(sections.wrap);

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
    const paths = (value) => {
      const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
      return parts.length > 1 ? parts : parts[0] || "";
    };
    const wanted = sections.area.value.split(",").map((s) => s.trim()).filter(Boolean);

    return {
      id: query.id,
      name: name.value.trim() || "Untitled",
      document: doc.area.value,
      variables: parsedVars,
      list: paths(listPath.area.value),
      count: paths(countPath.area.value),
      ...(wanted.length ? { detail: { sections: wanted } } : {}),
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

(async function boot() {
  clientInput.value = await GV.store.getClientId();
  queries = await GV.store.getQueries();
  draw();
  showAccount();
})();
