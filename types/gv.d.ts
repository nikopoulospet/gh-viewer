// The shape of the shared `GV` namespace.
//
// The extension's pages load classic scripts that share one global scope, so
// each library publishes itself onto a single global object rather than
// exporting. Nothing can infer that object's shape from the assignments, so it
// is declared here - this file is the contract between the libraries.
//
// Every member is optional, which is what lets each file open with
// `globalThis.GV = globalThis.GV || {}` without a cast. It still catches the
// case worth catching: reading a member that no library ever defines.
//
// The larger objects are `any` for now. Narrowing them is worthwhile but is a
// change per library, and the value here is mostly in the contract existing at
// all. Nothing is emitted from this file; it is types only.

interface GVNamespace {
  AuthError?: new (message?: string) => Error;

  BUILT_IN_CLIENT_ID?: string;
  APP_SLUG?: string;
  INSTALL_URL?: string;

  SEARCH_DOC?: string;
  DISCUSSION_DOC?: string;
  DETAIL_DOC?: string;
  DEFAULT_QUERIES?: GVQuery[];

  store?: any;
  api?: any;
  auth?: any;
  render?: any;
  diagnostics?: any;
  access?: any;

  markdown?: (html: string, className?: string) => Node;
  pluck?: (object: any, path: string) => any;
}

declare var GV: GVNamespace;
