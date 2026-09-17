"use strict";
// api.github.com sends permissive CORS headers, so the extension needs no host
// permission to query it - only the device-flow endpoints on github.com do.
const GV = globalThis.GV || (globalThis.GV = {});

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

  async whoAmI(token) {
    const { data } = await this.graphql("{ viewer { login avatarUrl } }", {}, token);
    return data?.viewer || null;
  },
};
