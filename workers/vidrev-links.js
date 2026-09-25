// Cloudflare Worker "steep-cake-5ab6vidrev-links", route */* on the vidrev.app
// zone (docs/SETUP-CLOUDFLARE.md). Sends link traffic (go.vidrev.app and every
// creator custom hostname) to the Railway web service and passes the original
// host in X-Original-Host. Replaces an Origin Rule Host rewrite, which the
// Free plan does not offer. Deployed by hand in the Cloudflare dashboard.
const worker = {
  async fetch(request) {
    const url = new URL(request.url);
    const originalHost = url.hostname;
    url.hostname = "web-production-7b0e1f.up.railway.app";
    url.port = "";
    const headers = new Headers(request.headers);
    headers.set("X-Original-Host", originalHost);
    return fetch(url.toString(), {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  },
};

export default worker;
