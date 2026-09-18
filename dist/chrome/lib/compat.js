"use strict";
// Chrome exposes the same WebExtension APIs under `chrome`, and in Manifest V3
// they return promises just as Firefox's `browser` does. Aliasing the namespace
// is therefore enough for everything this extension uses - storage, tabs,
// windows, runtime - and avoids pulling in a polyfill.
//
// On Firefox `browser` already exists, so this does nothing there.
globalThis.browser ??= globalThis.chrome;
