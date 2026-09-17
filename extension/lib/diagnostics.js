"use strict";
// Builds a shareable snapshot of the extension's state for bug reports.
//
// The hard rule: the access token never appears in the output. This report is
// meant to be pasted into an issue or a chat, and a user-to-server token would
// hand over everything the App can read. Only its shape is reported, which is
// enough to answer "are you actually signed in?" without leaking anything.
globalThis.GV = globalThis.GV || {};

(function () {
  const REDACTED = "<redacted>";

  function tokenShape(token) {
    if (!token) return { present: false };
    return {
      present: true,
      value: REDACTED,
      // The prefix identifies the credential TYPE, which matters: ghu_ is a
      // GitHub App user token, gho_ an OAuth app token, ghp_ a classic PAT.
      kind: /^gh[a-z]_/.test(token) ? `${token.slice(0, 4)}…` : "unrecognised",
      length: token.length,
    };
  }

  async function probeQueries(queries) {
    const results = [];
    for (const query of queries) {
      const started = Date.now();
      try {
        const { data, errors } = await GV.api.graphql(query.document, query.variables);
        results.push({
          id: query.id,
          name: query.name,
          ok: !errors?.length,
          ms: Date.now() - started,
          // Counts only - titles and URLs of private work stay out of a report
          // the user is about to paste somewhere public.
          // GV.collect/GV.total understand multi-path queries; fall back to a
          // single path so this works regardless of which is present.
          rows: (GV.collect ? GV.collect(data, query.list)
                            : GV.pluck(data, query.list) || []).length,
          total: GV.total ? GV.total(data, query.count)
                          : GV.pluck(data, query.count) ?? null,
          errors: (errors || []).map((e) => ({
            type: e.type || null,
            path: Array.isArray(e.path) ? e.path.join(".") : null,
            message: e.message,
          })),
        });
      } catch (e) {
        results.push({ id: query.id, name: query.name, ok: false, failure: e.message });
      }
    }
    return results;
  }

  GV.diagnostics = {
    // `probe` runs each saved query against the API so the report shows which
    // ones actually work. It costs one rate-limit point per query.
    async collect({ probe = false } = {}) {
      const manifest = browser.runtime.getManifest();
      const stored = await browser.storage.local.get(null);
      const queries = await GV.store.getQueries();

      const report = {
        generatedAt: new Date().toISOString(),
        extension: {
          name: manifest.name,
          version: manifest.version,
          permissions: manifest.permissions || [],
        },
        runtime: {
          userAgent: navigator.userAgent,
          language: navigator.language,
        },
        app: {
          slug: GV.APP_SLUG,
          clientId: await GV.store.getClientId(),
          usingBuiltInClientId: !stored.clientId,
        },
        session: {
          signedIn: Boolean(stored.token),
          viewer: stored.viewer?.login || null,
          token: tokenShape(stored.token),
        },
        storage: {
          keys: Object.keys(stored).sort(),
          usingDefaultQueries: !Array.isArray(stored.queries) || !stored.queries.length,
          selected: stored.selected || null,
        },
        queries: queries.map((query) => ({
          id: query.id,
          name: query.name,
          list: query.list,
          count: query.count,
          detail: query.detail || null,
          variables: query.variables,
          document: query.document,
        })),
      };

      if (probe) report.probe = await probeQueries(queries);
      return report;
    },

    toText(report) {
      return JSON.stringify(report, null, 2);
    },
  };
})();
