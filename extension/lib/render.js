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
      number title url bodyHTML state isDraft merged updatedAt createdAt
      reviewDecision
      author { login } repository { nameWithOwner }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      reviews(last: 20) { nodes { author { login } state submittedAt } }
      comments(last: 10) { nodes { author { login } createdAt bodyHTML url } }
      statusCheckRollup { state
        contexts(first: 100) { totalCount nodes {
          __typename
          ... on CheckRun { name conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } }
    }
    ... on Issue {
      number title url bodyHTML state updatedAt createdAt
      author { login } repository { nameWithOwner }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      comments(last: 10) { nodes { author { login } createdAt bodyHTML url } }
    }
    ... on Discussion {
      number title url bodyHTML updatedAt createdAt
      author { login } repository { nameWithOwner }
      category { name emoji }
      comments(last: 10) { nodes { author { login } createdAt bodyHTML url } }
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

// "1 comments" is the kind of thing nobody notices until it is in a screenshot.
function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
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
  return node?.statusCheckRollup?.state || null;
}

const CHECK_TONES = {
  SUCCESS: "ok", NEUTRAL: "ok", SKIPPED: "ok",
  FAILURE: "bad", ERROR: "bad", TIMED_OUT: "bad",
  CANCELLED: "bad", ACTION_REQUIRED: "bad",
};

function checkState(check) {
  return (check.conclusion || check.state || "").toUpperCase();
}

function checkTone(check) {
  return CHECK_TONES[checkState(check)] || "wait";
}

// Re-running a check adds another run with the same name rather than replacing
// it, and a busy PR carries 60+ contexts. Keep only the latest per name, and
// put anything failing first: sixty green checks are not why you opened the PR.
function summariseChecks(nodes) {
  const latest = new Map();
  for (const check of nodes) {
    latest.set(check.name || check.context || "", check);
  }
  const rank = (check) => ({ bad: 0, wait: 1, ok: 2 }[checkTone(check)]);
  return [...latest.values()].sort((a, b) => rank(a) - rank(b));
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
      meta.append(el("span", "comments", plural(node.comments.totalCount, "comment")));
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

    const checks = summariseChecks(node.statusCheckRollup?.contexts?.nodes || []);
    if (checks.length) {
      wrap.append(el("h3", "section", `Checks (${checks.length})`));
      const list = el("ul", "checks check-runs");
      for (const check of checks) {
        const item = el("li", "check");
        const state = checkState(check);
        item.append(el("span", `dot ${checkTone(check)}`, "●"));
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
      const list = el("ul", "checks review-list");
      for (const review of reviews) {
        const item = el("li", "check");
        item.append(el("span", null, review.author?.login || "someone"));
        item.append(el("span", "muted", review.state.toLowerCase().replace("_", " ")));
        item.append(el("span", "muted", relative(review.submittedAt)));
        list.append(item);
      }
      wrap.append(list);
    }

    if (node.bodyHTML) {
      wrap.append(el("h3", "section", "Description"));
      wrap.append(GV.markdown(node.bodyHTML));
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
        block.append(GV.markdown(comment.bodyHTML));
        wrap.append(block);
      }
    }

    return wrap;
  },
};
})();
