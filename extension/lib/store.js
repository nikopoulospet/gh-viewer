"use strict";
// Settings and saved queries. Everything lives in browser.storage.local -
// nothing is ever sent anywhere except to api.github.com.
globalThis.GV = globalThis.GV || {};

GV.AuthError = class AuthError extends Error {};

// The App's public client id. Registering the App is a one-time developer step,
// not something each user does, so this is a constant rather than a setup
// prompt. It is public by design - there is no secret anywhere in gh-viewer.
// A value saved in storage still overrides it, for testing against another App.
GV.BUILT_IN_CLIENT_ID = "Iv23liTmvm9SYEMbzQl7";
GV.APP_SLUG = "gh-viewer-sidebar";
GV.INSTALL_URL = `https://github.com/apps/${GV.APP_SLUG}/installations/new`;

// One document serves every issue/PR search: the fragments pick the fields
// that exist on each type. `id` is what the detail view drills down with.
const SEARCH_DOC = `query($q: String!, $first: Int = 30) {
  rateLimit { remaining }
  search(query: $q, type: ISSUE, first: $first) {
    issueCount
    nodes {
      __typename
      ... on PullRequest {
        id number title url isDraft state updatedAt reviewDecision
        author { login } repository { nameWithOwner }
        labels(first: 8) { nodes { name color } }
        comments { totalCount }
        statusCheckRollup { state }
      }
      ... on Issue {
        id number title url state updatedAt
        author { login } repository { nameWithOwner }
        labels(first: 8) { nodes { name color } }
        comments { totalCount }
      }
    }
  }
}`;

const DISCUSSION_DOC = `query($q: String!, $first: Int = 30) {
  rateLimit { remaining }
  search(query: $q, type: DISCUSSION, first: $first) {
    discussionCount
    nodes {
      __typename
      ... on Discussion {
        id number title url updatedAt
        author { login } repository { nameWithOwner }
        category { name emoji }
        comments { totalCount }
      }
    }
  }
}`;

// GitHub's issue search has no OR between qualifiers, so "assigned to me or
// opened by me" cannot be expressed as one search string. Two aliased searches
// travel in a single request for the same round trip, and the panel merges and
// dedupes the results (a PR you opened AND were assigned appears in both).
// `is:open` already includes drafts - a draft PR is an open PR.
const MINE_DOC = `query($assigned: String!, $authored: String!, $first: Int = 30) {
  rateLimit { remaining }
  assigned: search(query: $assigned, type: ISSUE, first: $first) {
    issueCount
    nodes { __typename ...row }
  }
  authored: search(query: $authored, type: ISSUE, first: $first) {
    issueCount
    nodes { __typename ...row }
  }
}

fragment row on PullRequest {
  id number title url isDraft state updatedAt reviewDecision
  statusCheckRollup { state }
  author { login } repository { nameWithOwner }
  labels(first: 8) { nodes { name color } }
  comments { totalCount }
}`;

GV.SEARCH_DOC = SEARCH_DOC;

// Seeded on first run. Every one is editable and deletable in the options page.
GV.DEFAULT_QUERIES = [
  {
    // Everything of mine in flight, however it became mine. `detail.sections`
    // trims the drill-in to just the description: for triaging your own work
    // the body is the point, not the check list.
    id: "my-prs",
    name: "My PRs (assigned or opened)",
    document: MINE_DOC,
    variables: {
      assigned: "is:pr is:open assignee:@me archived:false",
      authored: "is:pr is:open author:@me archived:false",
      first: 30,
    },
    list: ["assigned.nodes", "authored.nodes"],
    count: ["assigned.issueCount", "authored.issueCount"],
    detail: { sections: ["description"] },
  },
  {
    id: "my-open-prs",
    name: "My open PRs",
    document: SEARCH_DOC,
    variables: { q: "is:pr state:open assignee:@me archived:false", first: 30 },
    list: "search.nodes",
    count: "search.issueCount",
  },
  {
    // GitHub does not make a PR's author its assignee, so "assigned to me"
    // legitimately excludes your own PRs. This is the view that shows them.
    id: "prs-i-opened",
    name: "PRs I opened",
    document: SEARCH_DOC,
    variables: { q: "is:pr state:open author:@me archived:false", first: 30 },
    list: "search.nodes",
    count: "search.issueCount",
  },
  {
    id: "awaiting-my-review",
    name: "Awaiting my review",
    document: SEARCH_DOC,
    variables: { q: "is:pr state:open review-requested:@me archived:false", first: 30 },
    list: "search.nodes",
    count: "search.issueCount",
  },
  {
    id: "my-open-issues",
    name: "My open issues",
    document: SEARCH_DOC,
    variables: { q: "is:issue state:open assignee:@me archived:false", first: 30 },
    list: "search.nodes",
    count: "search.issueCount",
  },
  {
    id: "recent-discussions",
    name: "Recent discussions",
    document: DISCUSSION_DOC,
    variables: { q: "org:oauth-app-tester sort:updated-desc", first: 30 },
    list: "search.nodes",
    count: "search.discussionCount",
  },
];

GV.store = {
  async get(keys) {
    return browser.storage.local.get(keys);
  },

  async getClientId() {
    return (await browser.storage.local.get("clientId")).clientId || GV.BUILT_IN_CLIENT_ID;
  },

  async setClientId(clientId) {
    return browser.storage.local.set({ clientId: clientId.trim() });
  },

  async getToken() {
    return (await browser.storage.local.get("token")).token || "";
  },

  async setToken(token) {
    return browser.storage.local.set({ token });
  },

  async clearToken() {
    return browser.storage.local.remove(["token", "viewer"]);
  },

  async getViewer() {
    return (await browser.storage.local.get("viewer")).viewer || null;
  },

  async setViewer(viewer) {
    return browser.storage.local.set({ viewer });
  },

  // Deliberately does not persist the defaults. Writing them on first read
  // fired storage.onChanged, which re-booted the panel and ran the opening
  // query twice. Defaults stay in code until the user saves their own, which
  // also means improvements to them reach existing installs.
  async getQueries() {
    const { queries } = await browser.storage.local.get("queries");
    if (Array.isArray(queries) && queries.length) return queries;
    return GV.DEFAULT_QUERIES;
  },

  async saveQueries(queries) {
    return browser.storage.local.set({ queries });
  },

  async getSelectedQueryId() {
    return (await browser.storage.local.get("selected")).selected || "";
  },

  async setSelectedQueryId(selected) {
    return browser.storage.local.set({ selected });
  },
};

// A query's `list` may name one path or several. Several are concatenated and
// deduped by node id, which is how one view merges two searches.
GV.collect = function collect(data, list) {
  const paths = Array.isArray(list) ? list : [list];
  const seen = new Set();
  const nodes = [];
  for (const path of paths) {
    for (const node of GV.pluck(data, path) || []) {
      if (!node) continue;
      const key = node.id || `${node.url || ""}#${node.number || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(node);
    }
  }
  return nodes;
};

// `count` follows the same rule: several paths are summed. The total can
// exceed the rendered count, since the searches may overlap.
GV.total = function total(data, count) {
  if (count == null || count === "") return null;
  const paths = Array.isArray(count) ? count : [count];
  let sum = 0;
  for (const path of paths) {
    const value = GV.pluck(data, path);
    if (typeof value === "number") sum += value;
  }
  return sum;
};

// "search.nodes" -> data.search.nodes, tolerating nulls along the way.
GV.pluck = function pluck(object, path) {
  return String(path || "").split(".").filter(Boolean)
    .reduce((acc, key) => (acc == null ? acc : acc[key]), object);
};
