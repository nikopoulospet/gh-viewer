"use strict";
// Firefox defines `browser`; Chrome defines only `chrome`. The rest of the
// extension talks to `browser`, so give Chrome the same name. Chrome's MV3
// APIs already return promises when no callback is passed, which is the only
// other thing this code relies on.
if (typeof globalThis.browser === "undefined") {
  globalThis.browser = globalThis.chrome;
}
