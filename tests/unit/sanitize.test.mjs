import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage, mockBrowser } from "../harness.mjs";

// GV.markdown turns GitHub's rendered markdown into DOM. This runs in an
// extension page with access to browser.* and the stored token, so the
// allowlist is a security boundary, not a formatting nicety.
async function sanitizer() {
  const dom = await loadPage("sidebar/panel.html", { browser: mockBrowser() });
  return { markdown: dom.window.GV.markdown, window: dom.window };
}

test("ordinary markdown survives as real elements", async () => {
  const { markdown } = await sanitizer();
  const out = markdown("<p>hello <strong>world</strong> <code>x=1</code></p><ul><li>one</li></ul>");
  assert.equal(out.querySelectorAll("strong").length, 1);
  assert.equal(out.querySelectorAll("code").length, 1);
  assert.equal(out.querySelector("li").textContent, "one");
});

test("script tags are dropped entirely, contents and all", async () => {
  const { markdown } = await sanitizer();
  const out = markdown('<p>before</p><script>window.stolen = 1;</script><p>after</p>');
  assert.equal(out.querySelectorAll("script").length, 0);
  assert.doesNotMatch(out.textContent, /stolen/);
  assert.match(out.textContent, /before/);
  assert.match(out.textContent, /after/);
});

test("event handler attributes never survive", async () => {
  const { markdown } = await sanitizer();
  const out = markdown('<p onclick="alert(1)" onmouseover="alert(2)">text</p>');
  const p = out.querySelector("p");
  assert.equal(p.getAttribute("onclick"), null);
  assert.equal(p.getAttribute("onmouseover"), null);
});

test("javascript: and data: URLs are stripped from links", async () => {
  const { markdown } = await sanitizer();
  const out = markdown(
    '<a href="javascript:alert(1)">a</a>' +
    '<a href="data:text/html,<script>alert(1)</script>">b</a>'
  );
  for (const anchor of out.querySelectorAll("a")) {
    assert.equal(anchor.getAttribute("href"), null, "only http(s) may survive");
  }
  // The text is preserved even though the link target was refused.
  assert.match(out.textContent, /a/);
});

test("relative GitHub links resolve to absolute github.com URLs", async () => {
  const { markdown } = await sanitizer();
  // A moz-extension:// page has no github.com base, so a relative href would
  // otherwise resolve against the extension's own origin and go nowhere.
  const out = markdown('<a href="/example-org/example-repo/issues/39">#39</a>');
  assert.equal(
    out.querySelector("a").getAttribute("href"),
    "https://github.com/example-org/example-repo/issues/39"
  );
});

test("unknown elements are unwrapped, keeping their text", async () => {
  const { markdown } = await sanitizer();
  const out = markdown("<article><p>kept</p></article><marquee>also kept</marquee>");
  assert.equal(out.querySelectorAll("article, marquee").length, 0);
  assert.match(out.textContent, /kept/);
  assert.match(out.textContent, /also kept/);
});

test("iframes and forms are removed with their contents", async () => {
  const { markdown } = await sanitizer();
  const out = markdown('<iframe src="https://evil.example"></iframe>' +
                       '<form action="https://evil.example"><input name="x"></form>');
  assert.equal(out.querySelectorAll("iframe, form").length, 0);
  assert.equal(out.querySelectorAll("input").length, 0);
});

test("task list checkboxes render but are always disabled", async () => {
  const { markdown } = await sanitizer();
  const out = markdown('<ul><li><input type="checkbox" checked> done</li></ul>');
  const box = out.querySelector("input");
  assert.equal(box.getAttribute("type"), "checkbox");
  assert.notEqual(box.getAttribute("disabled"), null);
});
