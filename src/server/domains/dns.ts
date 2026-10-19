import type { FetchLike } from "@/server/google/oauth";

// DNS checks over DNS-over-HTTPS (Cloudflare 1.1.1.1), so results do not
// depend on the worker's resolver cache and tests can inject fetch.

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

const TYPES = { CNAME: 5, NS: 2, TXT: 16 } as const;

async function query(fetchFn: FetchLike, name: string, type: keyof typeof TYPES): Promise<string[]> {
  const response = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) throw new Error(`DNS lookup failed (${response.status})`);
  const json = (await response.json()) as { Status: number; Answer?: DohAnswer[] };
  return (json.Answer ?? [])
    .filter((a) => a.type === TYPES[type])
    .map((a) => (type === "TXT" ? a.data.replace(/^"|"$/g, "").replace(/" "/g, "") : a.data.toLowerCase().replace(/\.$/, "")));
}

export const lookupCname = (f: FetchLike, name: string) => query(f, name, "CNAME");
export const lookupNs = (f: FetchLike, name: string) => query(f, name, "NS");
export const lookupTxt = (f: FetchLike, name: string) => query(f, name, "TXT");

export interface DnsProvider {
  id: string;
  name: string;
  // Where the record is added, in the provider's own words.
  where: string;
  help?: string;
  note?: string;
  // Direct address of the DNS screen; {domain} is the registrable domain.
  open?: string;
  // Click-by-click guide; {domain}, {name} and {target} are filled in.
  steps?: string[];
}

// The generic guide when a provider has no own steps.
const GENERIC_STEPS = [
  "Sign in where your domain's DNS is managed ({where}).",
  "Open the DNS settings of {domain} and choose to add a new record.",
  "Type: choose CNAME.",
  "Name (or Host): paste {name}",
  "Value (or Target, Points to): paste {target}",
  "TTL: leave the default. Save.",
];

export function guideSteps(provider: DnsProvider | null, values: { domain: string; name: string; target: string }): { open: string | null; steps: string[] } {
  const fill = (s: string) =>
    s.replaceAll("{domain}", values.domain).replaceAll("{name}", values.name).replaceAll("{target}", values.target).replaceAll("{where}", provider?.where ?? "your domain provider");
  return { open: provider?.open ? fill(provider.open) : null, steps: (provider?.steps ?? GENERIC_STEPS).map(fill) };
}

const PROVIDERS: { pattern: RegExp; provider: DnsProvider }[] = [
  {
    pattern: /\.ns\.cloudflare\.com$/,
    provider: {
      id: "cloudflare",
      name: "Cloudflare",
      where: "Cloudflare dashboard > your domain > DNS > Records > Add record",
      help: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/",
      note: "Set Proxy status to DNS only (grey cloud).",
      open: "https://dash.cloudflare.com/?to=/:account/{domain}/dns/records",
      steps: [
        "Click Open Cloudflare DNS above and sign in. You land on the DNS records of {domain}.",
        "Click the blue + Add record button.",
        "Type: choose CNAME from the list.",
        "Name: paste {name}",
        "Target: paste {target}",
        "Proxy status: click the orange cloud switch once, so it turns grey and says DNS only.",
        "Click Save. Done: we check it automatically and email you when it is live.",
      ],
    },
  },
  {
    pattern: /\.domaincontrol\.com$/,
    provider: {
      id: "godaddy",
      name: "GoDaddy",
      where: "GoDaddy > My Products > your domain > DNS > Add New Record",
      help: "https://www.godaddy.com/help/add-a-cname-record-19236",
      open: "https://dcc.godaddy.com/control/dnsmanagement?domainName={domain}",
      steps: [
        "Click Open GoDaddy DNS above and sign in. You land on the DNS records of {domain}.",
        "Click Add New Record.",
        "Type: choose CNAME.",
        "Name: paste {name}",
        "Value: paste {target}",
        "TTL: leave the default. Click Save.",
      ],
    },
  },
  {
    pattern: /\.registrar-servers\.com$/,
    provider: {
      id: "namecheap",
      name: "Namecheap",
      where: "Namecheap > Domain List > Manage > Advanced DNS > Add New Record",
      help: "https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/",
      open: "https://ap.www.namecheap.com/Domains/DomainControlPanel/{domain}/advancedns",
      steps: [
        "Click Open Namecheap DNS above and sign in. You land on Advanced DNS of {domain}.",
        "Under Host Records, click Add New Record.",
        "Type: choose CNAME Record.",
        "Host: paste {name}",
        "Value: paste {target}",
        "TTL: leave Automatic. Click the green check mark to save.",
      ],
    },
  },
  {
    pattern: /awsdns/,
    provider: {
      id: "route53",
      name: "Amazon Route 53",
      where: "Route 53 console > Hosted zones > your domain > Create record",
      help: "https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-creating.html",
    },
  },
  { pattern: /\.ui-dns\./, provider: { id: "ionos", name: "IONOS", where: "IONOS > Domains & SSL > your domain > DNS > Add record" } },
  { pattern: /(googledomains\.com|squarespacedns\.com)$/, provider: { id: "squarespace", name: "Squarespace Domains", where: "Squarespace > Domains > your domain > DNS > Add record" } },
  { pattern: /dns-parking\.com$|hostinger/, provider: { id: "hostinger", name: "Hostinger", where: "Hostinger hPanel > Domains > DNS / Nameservers > Manage DNS records" } },
  { pattern: /wixdns\.net$/, provider: { id: "wix", name: "Wix", where: "Wix > Domains > your domain > Manage DNS Records > CNAME > Add Record" } },
  { pattern: /\.porkbun\.com$/, provider: { id: "porkbun", name: "Porkbun", where: "Porkbun > Domain Management > DNS" } },
  { pattern: /\.name\.com$/, provider: { id: "namecom", name: "Name.com", where: "Name.com > My Domains > your domain > Manage DNS Records" } },
  { pattern: /\.hover\.com$/, provider: { id: "hover", name: "Hover", where: "Hover > your domain > DNS > Add a record" } },
  { pattern: /\.gandi\.net$/, provider: { id: "gandi", name: "Gandi", where: "Gandi > Domain > DNS records > Add record" } },
  { pattern: /\.bluehost\.com$/, provider: { id: "bluehost", name: "Bluehost", where: "Bluehost > Domains > DNS > CNAME > Add Record" } },
  { pattern: /\.hostgator\.com$/, provider: { id: "hostgator", name: "HostGator", where: "HostGator > Domains > DNS > Add DNS Record" } },
  { pattern: /\.siteground\.net$/, provider: { id: "siteground", name: "SiteGround", where: "SiteGround Site Tools > Domain > DNS Zone Editor > CNAME" } },
  { pattern: /\.digitalocean\.com$/, provider: { id: "digitalocean", name: "DigitalOcean", where: "DigitalOcean > Networking > Domains > your domain > CNAME" } },
  { pattern: /vercel-dns\.com$/, provider: { id: "vercel", name: "Vercel", where: "Vercel > Domains > your domain > DNS Records > Add" } },
  { pattern: /\.ovh\.net$/, provider: { id: "ovh", name: "OVHcloud", where: "OVHcloud > Web Cloud > Domain names > DNS zone > Add an entry" } },
  { pattern: /\.dynadot\.com$/, provider: { id: "dynadot", name: "Dynadot", where: "Dynadot > My Domains > DNS Settings" } },
  { pattern: /azure-dns\./, provider: { id: "azure", name: "Azure DNS", where: "Azure portal > DNS zones > your domain > + Record set" } },
];

export function detectProvider(nameservers: readonly string[]): DnsProvider | null {
  for (const ns of nameservers) {
    const hit = PROVIDERS.find((p) => p.pattern.test(ns.toLowerCase().replace(/\.$/, "")));
    if (hit) return hit.provider;
  }
  return null;
}

export function providerById(id: string | null | undefined): DnsProvider | null {
  return PROVIDERS.find((p) => p.provider.id === id)?.provider ?? null;
}

// The record the creator adds: host label relative to the registrable domain.
export function cnameRecord(hostname: string, registrable: string, target: string) {
  const name = hostname === registrable ? "@" : hostname.slice(0, -(registrable.length + 1));
  return { type: "CNAME", name, target };
}
