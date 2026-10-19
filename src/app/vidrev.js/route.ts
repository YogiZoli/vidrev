// Optional opt-in page helper (CC-07 layer 3). The creator adds
// <script src="https://<app or link host>/vidrev.js" async></script> to the
// opt-in page. It takes vidrev_tid from the URL or the first-party cookie the
// redirect set on the creator's domain, remembers it on the page's own domain
// for 180 days, and fills every field named vidrev_tid, also ones added later.
// Forms inside third-party iframes cannot be reached; UTM capture covers them.
const SCRIPT = `(function () {
  var NAME = "vidrev_tid", DAYS = 180;
  function valid(v) { return typeof v === "string" && /^[A-Za-z0-9]{10}$/.test(v) ? v : null; }
  function fromUrl() { try { return valid(new URLSearchParams(location.search).get(NAME)); } catch (e) { return null; } }
  function fromCookie() { var m = document.cookie.match(/(?:^|; )vidrev_tid=([^;]*)/); return m ? valid(decodeURIComponent(m[1])) : null; }
  function remember(v) {
    var parts = location.hostname.split("."), exp = "; Max-Age=" + DAYS * 86400 + "; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    for (var i = parts.length - 2; i >= 0; i--) {
      document.cookie = NAME + "=" + v + exp + "; Domain=" + parts.slice(i).join(".");
      if (fromCookie() === v) return;
    }
    document.cookie = NAME + "=" + v + exp;
  }
  var script = document.currentScript;
  var tid = fromUrl() || fromCookie();
  if (!tid) return;
  if (fromUrl()) {
    remember(tid);
    // Direct branded links (A-38) have no redirect: report the visit once.
    try {
      var base = script && script.src ? new URL(script.src).origin : "";
      if (base && navigator.sendBeacon) navigator.sendBeacon(base + "/api/v1/visit", JSON.stringify({ tid: tid }));
    } catch (e) {}
  }
  function fill(root) {
    var fields = (root.querySelectorAll ? root : document).querySelectorAll('input[name="' + NAME + '"], input[data-vidrev-tid]');
    for (var i = 0; i < fields.length; i++) if (!fields[i].value) { fields[i].value = tid; fields[i].dispatchEvent(new Event("input", { bubbles: true })); }
  }
  function start() {
    fill(document);
    if (window.MutationObserver) new MutationObserver(function () { fill(document); }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.vidrevTid = tid;
})();
`;

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
