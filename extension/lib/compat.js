"use strict";
// Firefox defines `browser`; Chrome defines only `chrome`. The rest of the
// extension talks to `browser`, so give Chrome the same name. Chrome's MV3
// APIs already return promises when no callback is passed, which is the only
// other thing this code relies on.
if (typeof globalThis.browser === "undefined") {
  // The two namespaces are not identical and the types say so. This shim is a
  // deliberate narrowing: the APIs the extension actually calls do line up, and
  // Chrome's MV3 versions return promises like Firefox's.
  globalThis.browser = /** @type {typeof globalThis.browser} */ (
    /** @type {unknown} */ (globalThis.chrome));
}
