import http from "node:http";
import https from "node:https";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { checkWebhookUrl } from "@/lib/net-guard";
import { safeLookup } from "@/server/integrations/http-post";

// Reads one page of a link found in a creator's description (SPEC-REVIEW R-16,
// DECISIONS P9-05). The URL comes from a public video description, so it is
// untrusted: public hosts only, ports 80 and 443, at most 3 redirects with
// every hop checked again, 5 s per request, 1 MB of body, and the resolved
// address is checked at connect time (safeLookup) against DNS rebinding.

export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 1_000_000;
const TIMEOUT_MS = 5_000;

export interface PageFetch {
  finalUrl: string;
  status: number;
  // Up to 1 MB of the page as text, empty when it could not be read.
  body: string;
}

export type PageFetcher = (url: string) => Promise<PageFetch>;

export function checkPageUrl(raw: string): { ok: true; url: URL } | { ok: false } {
  const check = checkWebhookUrl(raw, { allowHttp: true });
  if (!check.ok) return { ok: false };
  const port = check.url.port;
  if (port !== "" && port !== "80" && port !== "443") return { ok: false };
  return { ok: true, url: check.url };
}

interface Hop {
  status: number;
  location: string | null;
  body: string;
}

function requestOnce(url: URL): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "http:" ? http : https;
    const timer = setTimeout(() => request.destroy(new Error("timeout")), TIMEOUT_MS);
    const request = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        headers: {
          "user-agent": "vidrev-audit/1.0 (+https://vidrev.app/audit)",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : null;
        if (status >= 300 && status < 400) {
          response.resume();
          clearTimeout(timer);
          resolve({ status, location, body: "" });
          return;
        }
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
        const decoder = encoding.includes("br")
          ? zlib.createBrotliDecompress()
          : encoding.includes("gzip")
            ? zlib.createGunzip()
            : encoding.includes("deflate")
              ? zlib.createInflate()
              : new PassThrough();
        const chunks: Buffer[] = [];
        let size = 0;
        const sink = new PassThrough();
        sink.on("data", (chunk: Buffer) => {
          if (size >= MAX_BODY_BYTES) return;
          const take = chunk.subarray(0, MAX_BODY_BYTES - size);
          chunks.push(take);
          size += take.length;
          if (size >= MAX_BODY_BYTES) response.destroy();
        });
        const done = () => {
          clearTimeout(timer);
          resolve({ status, location: null, body: Buffer.concat(chunks).toString("utf8") });
        };
        pipeline(response, decoder, sink).then(done, done);
      },
    );
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

// Follows redirects by hand. Any failure returns what is known so far (an
// empty body), so one broken link never fails the audit.
export const fetchPage: PageFetcher = async (rawUrl) => {
  let current = rawUrl;
  let status = 0;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = checkPageUrl(current);
    if (!check.ok) return { finalUrl: current, status: 0, body: "" };
    try {
      const result = await requestOnce(check.url);
      status = result.status;
      if (result.location) {
        try {
          current = new URL(result.location, check.url).toString();
        } catch {
          return { finalUrl: current, status, body: "" };
        }
        continue;
      }
      return { finalUrl: current, status, body: result.body };
    } catch {
      return { finalUrl: current, status: 0, body: "" };
    }
  }
  return { finalUrl: current, status, body: "" };
};
