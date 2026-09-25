import { createSign } from "node:crypto";
import type { FetchLike } from "@/server/google/oauth";
import { lookupTxt } from "./dns";

// Domain Connect one-click setup (D-38). The DNS provider of the creator's
// domain publishes a _domainconnect TXT record; if the provider has onboarded
// our template (docs/domain-connect/), the creator clicks one button, logs in
// at their provider and approves the CNAME. Until a provider approves the
// template, discovery finds no support and the manual guide is shown.

export interface DomainConnectConfig {
  providerId: string;
  serviceId: string;
  // PEM private key; its public key is published as a TXT record at
  // <keyHost>.<providerId>. Needed for redirect_uri and by most providers.
  privateKey?: string;
  keyHost?: string;
}

export interface DomainConnectSupport {
  providerId: string;
  providerName: string;
  urlSyncUX: string;
}

function https(value: string): string {
  return value.startsWith("http") ? value.replace(/\/+$/, "") : `https://${value.replace(/\/+$/, "")}`;
}

// Returns the provider's sync UX when it supports our template, else null.
export async function discoverDomainConnect(fetchFn: FetchLike, registrable: string, config: DomainConnectConfig): Promise<DomainConnectSupport | null> {
  const [apiHost] = await lookupTxt(fetchFn, `_domainconnect.${registrable}`);
  if (!apiHost) return null;
  const settingsResponse = await fetchFn(`${https(apiHost)}/v2/${encodeURIComponent(registrable)}/settings`, { headers: { accept: "application/json" } });
  if (!settingsResponse.ok) return null;
  const settings = (await settingsResponse.json()) as { providerId?: string; providerName?: string; urlSyncUX?: string; urlAPI?: string };
  if (!settings.urlSyncUX || !settings.urlAPI) return null;
  const template = await fetchFn(
    `${https(settings.urlAPI)}/v2/domainTemplates/providers/${encodeURIComponent(config.providerId)}/services/${encodeURIComponent(config.serviceId)}`,
  );
  if (!template.ok) return null;
  return { providerId: settings.providerId ?? "", providerName: settings.providerName ?? settings.providerId ?? "your DNS provider", urlSyncUX: https(settings.urlSyncUX) };
}

// The synchronous apply URL. `host` is the label under the registrable
// domain (e.g. "go"); the template points it at our CNAME target.
export function applyUrl(
  support: Pick<DomainConnectSupport, "urlSyncUX">,
  config: DomainConnectConfig,
  input: { registrable: string; host: string; redirectUri?: string; state?: string },
): string {
  const params = new URLSearchParams({ domain: input.registrable, host: input.host });
  const signed = Boolean(config.privateKey && config.keyHost);
  if (input.redirectUri && signed) params.set("redirect_uri", input.redirectUri);
  if (input.state) params.set("state", input.state);
  let query = params.toString();
  if (signed) {
    const sig = createSign("RSA-SHA256").update(query).sign(config.privateKey!, "base64");
    query += `&sig=${encodeURIComponent(sig)}&key=${encodeURIComponent(config.keyHost!)}`;
  }
  return `${support.urlSyncUX}/v2/domainTemplates/providers/${encodeURIComponent(config.providerId)}/services/${encodeURIComponent(config.serviceId)}/apply?${query}`;
}
