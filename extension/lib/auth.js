"use strict";
// GitHub App device flow. Only a public client_id is involved - there is no
// client secret anywhere in this extension, which is why the App must have
// "Expire user authorization tokens" switched OFF (refreshing would need one).
const GV = globalThis.GV || (globalThis.GV = {});

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

GV.auth = {
  // Step 1: ask GitHub for a user code to display.
  async requestDeviceCode(clientId) {
    const body = await postForm(DEVICE_CODE_URL, { client_id: clientId });
    if (body.error || !body.device_code) {
      throw new Error(
        body.error === "device_flow_disabled"
          ? "Device Flow is not enabled on the App. Turn it on in the App settings."
          : body.error_description || body.error || "could not start device flow"
      );
    }
    return body;
  },

  // Step 2: poll until the user approves in the other tab. `onWait` lets the
  // panel keep a countdown honest instead of looking frozen.
  // Returns the whole grant, not just the token: an `expires_in` in the reply
  // means the App has token expiration switched on, which this extension cannot
  // recover from (refreshing needs a client secret). The panel warns about it
  // at connect time rather than letting it fail silently hours later.
  async pollForToken(clientId, device, { signal, onWait } = {}) {
    let interval = (device.interval || 5) * 1000;
    const deadline = Date.now() + (device.expires_in || 900) * 1000;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("cancelled");
      const secondsLeft = Math.round((deadline - Date.now()) / 1000);
      onWait?.(secondsLeft);
      await new Promise((r) => setTimeout(r, interval));

      const body = await postForm(TOKEN_URL, {
        client_id: clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });

      if (body.access_token) return body;
      if (body.error === "authorization_pending") continue;
      if (body.error === "slow_down") {
        interval = (body.interval || interval / 1000 + 5) * 1000;
        continue;
      }
      throw new Error(body.error_description || body.error || "device flow failed");
    }
    throw new Error("the code expired - try connecting again");
  },
};
