import type { FetchLike } from "@/server/google/oauth";

// Cloudflare for SaaS custom hostnames on the owner's zone (D-33, R-03). The
// creator points go.theirdomain.com at CUSTOM_HOSTNAME_CNAME_TARGET; the
// certificate is validated over HTTP through that CNAME, so the creator needs
// no Cloudflare account and no extra TXT record.

export interface CloudflareConfig {
  apiToken: string;
  zoneId: string;
}

export interface CustomHostname {
  id: string;
  hostname: string;
  // pending, active, moved, deleted, blocked, ...
  status: string;
  sslStatus: string | null;
  errors: string[];
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: number[],
  ) {
    super(message);
    this.name = "CloudflareError";
  }
}

interface ApiHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_errors?: { message?: string }[] };
  verification_errors?: string[];
}

function toHostname(raw: ApiHostname): CustomHostname {
  return {
    id: raw.id,
    hostname: raw.hostname,
    status: raw.status,
    sslStatus: raw.ssl?.status ?? null,
    errors: [...(raw.verification_errors ?? []), ...(raw.ssl?.validation_errors ?? []).map((e) => e.message ?? "")].filter(Boolean),
  };
}

async function call<T>(fetchFn: FetchLike, config: CloudflareConfig, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code: number; message: string }[] };
  if (!response.ok || json.success === false) {
    const errors = json.errors ?? [];
    throw new CloudflareError(errors.map((e) => e.message).join("; ") || `Cloudflare ${response.status}`, response.status, errors.map((e) => e.code));
  }
  return json.result as T;
}

export async function createCustomHostname(fetchFn: FetchLike, config: CloudflareConfig, hostname: string): Promise<CustomHostname> {
  const result = await call<ApiHostname>(fetchFn, config, "POST", "/custom_hostnames", {
    hostname,
    ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
  });
  return toHostname(result);
}

export async function findCustomHostname(fetchFn: FetchLike, config: CloudflareConfig, hostname: string): Promise<CustomHostname | null> {
  const result = await call<ApiHostname[]>(fetchFn, config, "GET", `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  const match = result.find((h) => h.hostname === hostname);
  return match ? toHostname(match) : null;
}

export async function getCustomHostname(fetchFn: FetchLike, config: CloudflareConfig, id: string): Promise<CustomHostname | null> {
  try {
    return toHostname(await call<ApiHostname>(fetchFn, config, "GET", `/custom_hostnames/${encodeURIComponent(id)}`));
  } catch (error) {
    if (error instanceof CloudflareError && error.status === 404) return null;
    throw error;
  }
}

export async function deleteCustomHostname(fetchFn: FetchLike, config: CloudflareConfig, id: string): Promise<void> {
  try {
    await call(fetchFn, config, "DELETE", `/custom_hostnames/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof CloudflareError && error.status === 404) return;
    throw error;
  }
}

export function isLive(hostname: CustomHostname): boolean {
  return hostname.status === "active" && hostname.sslStatus === "active";
}
