"use strict";
// api.github.com sends permissive CORS headers, so the extension needs no host
// permission to query it - only the device-flow endpoints on github.com do.
globalThis.GV = globalThis.GV || {};

const ENDPOINT = "https://api.github.com/graphql";

GV.api = {
  async graphql(document, variables, token) {
    token = token || (await GV.store.getToken());
    if (!token) throw new GV.AuthError("not connected");

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: document, variables: variables || {} }),
    });

    if (res.status === 401) {
      await GV.store.clearToken();
      throw new GV.AuthError("GitHub rejected the token - reconnect");
    }
    if (!res.ok) {
      throw new Error(`GitHub returned HTTP ${res.status}`);
    }

    const body = await res.json();
    // GraphQL answers partially: a field the App has no permission for comes
    // back null with an entry in `errors`, while the rest of the data is fine.
    // Callers render `data` and surface `errors` as a warning.
    return { data: body.data, errors: body.errors || null };
  },

  // GitHub's GraphQL search has no boolean operators; REST search does, behind
  // advanced_search=true. Same host, same token, same CORS allowance.
  async rest(path, params, token) {
    token = token || (await GV.store.getToken());
    if (!token) throw new GV.AuthError("not connected");

    const url = new URL(`https://api.github.com${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 401) {
      await GV.store.clearToken();
      throw new GV.AuthError("GitHub rejected the token - reconnect");
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 422 carries the useful detail (a malformed qualifier, say) in errors[].
      const detail = body.errors?.[0]?.message || body.message || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return body;
  },

  async whoAmI(token) {
    const { data } = await this.graphql("{ viewer { login avatarUrl } }", {}, token);
    return data?.viewer || null;
  },
};
