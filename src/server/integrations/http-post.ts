import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isPrivateAddress } from "@/lib/net-guard";

export type PostFn = (url: string, body: string, headers: Record<string, string>, timeoutMs?: number) => Promise<{ status: number }>;

// Resolves the host and refuses any private address at connect time, so a DNS
// record that changes after the URL was saved (rebinding) cannot reach our
// network. All returned addresses must be public.
const safeLookup: NonNullable<https.RequestOptions["lookup"]> = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("blocked_address"), { code: "EBLOCKED" }), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

// POST a JSON body to a creator's endpoint. Redirects are never followed (the
// caller treats 3xx as a failed delivery) and the response body is discarded.
export const postJson: PostFn = (rawUrl, body, headers, timeoutMs = 10_000) =>
  new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const lib = url.protocol === "http:" ? http : https;
    const timer = setTimeout(() => request.destroy(new Error("timeout")), timeoutMs);
    const request = lib.request(
      url,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, lookup: safeLookup },
      (response) => {
        response.resume();
        response.on("end", () => {
          clearTimeout(timer);
          resolve({ status: response.statusCode ?? 0 });
        });
        response.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end(body);
  });
