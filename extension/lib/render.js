"use strict";
// All GitHub-supplied strings (titles, labels, comment bodies) are inserted
// with textContent, never innerHTML - a PR title is untrusted input.
globalThis.GV = globalThis.GV || {};

// Drill-down. Deliberately omits additions/deletions/changedFiles and anything
// else derived from the diff: this App never asks for code.
GV.DETAIL_DOC = `query($id: ID!) {
  node(id: $id) {
    __typename
    ... on PullRequest {
      number title url bodyText state isDraft merged updatedAt createdAt
      reviewDecision
      author { login } repository { nameWithOwner }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      reviews(last: 20) { nodes { author { login } state submittedAt } }
      comments(last: 10) { nodes { author { login } createdAt bodyText url } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state
        contexts(first: 30) { nodes {
          __typename
          ... on CheckRun { name conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } } } } }
    }
    ... on Issue {
      number title url bodyText state updatedAt createdAt
      author { login } repository { nameWithOwner }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      comments(last: 10) { nodes { author { login } createdAt bodyText url } }
    }
    ... on Discussion {
      number title url bodyText updatedAt createdAt
      author { login } repository { nameWithOwner }
      category { name emoji }
      comments(last: 10) { nodes { author { login } createdAt bodyText url } }
    }
  }
}`;

(function () {
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function relative(iso) {
  if (!iso) return "";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  const steps = [[31536000, "y"], [2592000, "mo"], [604800, "w"],
                 [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [size, unit] of steps) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return "just now";
}

// GitHub gives label colours as bare hex; pick readable text to sit on them.
function labelChip(label) {
  const chip = el("span", "chip label", label.name);
  if (/^[0-9a-f]{6}$/i.test(label.color || "")) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(label.color.slice(i, i + 2), 16));
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    chip.style.backgroundColor = `#${label.color}`;
    chip.style.color = luminance > 0.6 ? "#111" : "#fff";
  }
  return chip;
}

const REVIEW_LABELS = {
  APPROVED: ["approved", "ok"],
  CHANGES_REQUESTED: ["changes requested", "bad"],
  REVIEW_REQUIRED: ["review required", "wait"],
};

const CI_LABELS = {
  SUCCESS: ["ci ok", "ok"],
  FAILURE: ["ci failed", "bad"],
  ERROR: ["ci error", "bad"],
  PENDING: ["ci running", "wait"],
  EXPECTED: ["ci expected", "wait"],
};

function ciState(node) {
  const commit = node?.commits?.nodes?.[0]?.commit;
  return commit?.statusCheckRollup?.state || null;
}

GV.render = {
  relative,

  // A results row. Clicking the row drills down; clicking the ↗ opens the tab.
  row(node) {
    const row = el("li", "row");
    row.dataset.id = node.id || "";

    const top = el("div", "row-top");
    const title = el("span", "title", node.title);
    top.append(title);
    row.append(top);

    const meta = el("div", "row-meta");
    const repo = node.repository?.nameWithOwner || "";
    meta.append(el("span", "num", `${repo}#${node.number}`));
    if (node.author?.login) meta.append(el("span", "author", node.author.login));
    meta.append(el("span", "when", relative(node.updatedAt)));
    if (node.comments?.totalCount) {
      meta.append(el("span", "comments", `${node.comments.totalCount} comments`));
    }
    row.append(meta);

    const chips = el("div", "chips");
    if (node.isDraft) chips.append(el("span", "chip wait", "draft"));
    if (node.state && node.state !== "OPEN") {
      chips.append(el("span", "chip", node.state.toLowerCase()));
    }
    const review = REVIEW_LABELS[node.reviewDecision];
    if (review) chips.append(el("span", `chip ${review[1]}`, review[0]));
    const ci = CI_LABELS[ciState(node)];
    if (ci) chips.append(el("span", `chip ${ci[1]}`, ci[0]));
    if (node.category?.name) {
      chips.append(el("span", "chip", `${node.category.emoji || ""} ${node.category.name}`.trim()));
    }
    for (const label of node.labels?.nodes || []) chips.append(labelChip(label));
    if (chips.childNodes.length) row.append(chips);

    const open = el("a", "open", "↗");
    open.href = node.url;
    open.title = "Open in a new tab";
    row.append(open);
    return row;
  },

  list(nodes) {
    const list = el("ul", "rows");
    for (const node of nodes) {
      if (node) list.append(this.row(node));
    }
    return list;
  },

  detail(node) {
    const wrap = el("div", "detail");

    const heading = el("h2", "detail-title", node.title);
    wrap.append(heading);

    const meta = el("div", "row-meta");
    meta.append(el("span", "num", `${node.repository?.nameWithOwner || ""}#${node.number}`));
    if (node.author?.login) meta.append(el("span", "author", node.author.login));
    meta.append(el("span", "when", `updated ${relative(node.updatedAt)}`));
    wrap.append(meta);

    const link = el("a", "detail-link", "Open on GitHub ↗");
    link.href = node.url;
    wrap.append(link);

    const chips = el("div", "chips");
    if (node.isDraft) chips.append(el("span", "chip wait", "draft"));
    if (node.merged) chips.append(el("span", "chip ok", "merged"));
    const review = REVIEW_LABELS[node.reviewDecision];
    if (review) chips.append(el("span", `chip ${review[1]}`, review[0]));
    for (const label of node.labels?.nodes || []) chips.append(labelChip(label));
    for (const assignee of node.assignees?.nodes || []) {
      chips.append(el("span", "chip", `@${assignee.login}`));
    }
    if (chips.childNodes.length) wrap.append(chips);

    const checks = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || [];
    if (checks.length) {
      wrap.append(el("h3", "section", "Checks"));
      const list = el("ul", "checks");
      for (const check of checks) {
        const item = el("li", "check");
        const state = (check.conclusion || check.state || "").toUpperCase();
        const tone = ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state) ? "ok"
                   : ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(state) ? "bad" : "wait";
        item.append(el("span", `dot ${tone}`, "●"));
        const url = check.detailsUrl || check.targetUrl;
        if (url) {
          const anchor = el("a", null, check.name || check.context);
          anchor.href = url;
          item.append(anchor);
        } else {
          item.append(el("span", null, check.name || check.context));
        }
        item.append(el("span", "muted", state.toLowerCase()));
        list.append(item);
      }
      wrap.append(list);
    }

    const reviews = node.reviews?.nodes?.filter((r) => r.state !== "COMMENTED") || [];
    if (reviews.length) {
      wrap.append(el("h3", "section", "Reviews"));
      const list = el("ul", "checks");
      for (const review of reviews) {
        const item = el("li", "check");
        item.append(el("span", null, review.author?.login || "someone"));
        item.append(el("span", "muted", review.state.toLowerCase().replace("_", " ")));
        item.append(el("span", "muted", relative(review.submittedAt)));
        list.append(item);
      }
      wrap.append(list);
    }

    if (node.bodyText) {
      wrap.append(el("h3", "section", "Description"));
      wrap.append(el("p", "body", node.bodyText.slice(0, 2000)));
    }

    const comments = node.comments?.nodes || [];
    if (comments.length) {
      wrap.append(el("h3", "section", `Latest comments`));
      for (const comment of comments.slice(-5).reverse()) {
        const block = el("div", "comment");
        const head = el("div", "row-meta");
        head.append(el("span", "author", comment.author?.login || "someone"));
        head.append(el("span", "when", relative(comment.createdAt)));
        if (comment.url) {
          const anchor = el("a", "open", "↗");
          anchor.href = comment.url;
          head.append(anchor);
        }
        block.append(head);
        block.append(el("p", "body", (comment.bodyText || "").slice(0, 600)));
        wrap.append(block);
      }
    }

    return wrap;
  },
};
})();
