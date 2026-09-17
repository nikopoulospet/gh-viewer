"use strict";
// Turns GitHub's rendered markdown (`bodyHTML`) into DOM, through an allowlist.
//
// This is an extension page: script running here can reach the browser.* APIs
// and the stored token, so API-supplied HTML must never go near innerHTML
// directly. The page CSP already blocks inline script and eval, which makes
// this defence in depth rather than the only line - but the allowlist is what
// guarantees that only known-inert markup survives.
globalThis.GV = globalThis.GV || {};

(function () {
  // tag -> attributes kept. Everything else is dropped or unwrapped.
  const ALLOWED = {
    p: [], br: [], hr: [],
    strong: [], b: [], em: [], i: [], s: [], del: [], ins: [], sup: [], sub: [],
    code: [], pre: [], kbd: [], samp: [],
    ul: [], ol: ["start"], li: [],
    blockquote: [], q: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ["align"], td: ["align"],
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    details: [], summary: [],
    span: [], div: [],
    input: ["type", "checked", "disabled"], // markdown task lists
  };

  // Dropped with their contents: they carry no readable text worth keeping.
  const PURGE = new Set(["script", "style", "iframe", "object", "embed", "link",
                         "meta", "form", "button", "textarea", "select", "svg",
                         "math", "noscript", "template", "base"]);

  // GitHub emits site-relative links (/owner/repo/pull/1). Resolve against
  // github.com so they work from a moz-extension:// page, and refuse any
  // scheme that is not plain http(s).
  function safeUrl(value) {
    try {
      const url = new URL(value, "https://github.com");
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function clean(source, target, doc) {
    for (const node of [...source.childNodes]) {
      if (node.nodeType === 3) {
        target.append(doc.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== 1) continue; // comments, CDATA, processing instructions

      const tag = node.tagName.toLowerCase();
      if (PURGE.has(tag)) continue;

      // An unrecognised wrapper still has readable children; keep the text and
      // drop the element itself rather than losing the content.
      if (!(tag in ALLOWED)) {
        clean(node, target, doc);
        continue;
      }

      const element = doc.createElement(tag);
      for (const attribute of ALLOWED[tag]) {
        if (!node.hasAttribute(attribute)) continue;
        let value = node.getAttribute(attribute);
        if (attribute === "href" || attribute === "src") {
          value = safeUrl(value);
          if (!value) continue;
        }
        element.setAttribute(attribute, value);
      }
      if (tag === "input") {
        // Task-list checkboxes are decoration, never something to submit.
        element.setAttribute("disabled", "");
        if (element.getAttribute("type") !== "checkbox") continue;
      }
      clean(node, element, doc);
      target.append(element);
    }
  }

  // Returns a detached element holding the sanitised markup.
  GV.markdown = function markdown(html, className = "body markdown") {
    const wrapper = document.createElement("div");
    wrapper.className = className;
    if (!html) return wrapper;

    // Parsed in an inert document: no scripts run, no resources load.
    const parsed = new DOMParser().parseFromString(String(html), "text/html");
    clean(parsed.body, wrapper, document);
    return wrapper;
  };
})();
