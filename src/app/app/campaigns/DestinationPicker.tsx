"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { DEFAULT_KEYWORD } from "@/lib/keyword-catalog";

export type Kind = "optin" | "order" | "page" | "survey" | "calendar";
export interface DestinationOption {
  kind: Kind;
  name: string;
  path?: string;
  url?: string;
}

const GROUP_LABEL: Record<Kind, string> = {
  optin: "Opt-in pages",
  order: "Order and checkout pages",
  page: "Other pages",
  survey: "Surveys",
  calendar: "Booking calendars",
};

// What fits each trigger keyword first: CALL books a call, SURVEY is the ASK
// survey, the buying keywords go to a checkout, everything else to an opt-in.
export function preferredKinds(keyword: string): Kind[] {
  if (keyword === "CALL") return ["calendar", "optin", "order", "page", "survey"];
  if (keyword === "SURVEY") return ["survey", "optin", "page", "order", "calendar"];
  if (["TRIGGER", "BUY", "APPLY", "ACTION"].includes(keyword)) return ["order", "optin", "calendar", "page", "survey"];
  return ["optin", "page", "survey", "calendar", "order"];
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

// Step 3 "Where do they go?": the creator's GoHighLevel pages, surveys and
// calendars, the kind that fits the chosen keyword first. A page address is
// the Sub-account's domain plus the page path (editable). Advanced: any URL.
export function DestinationPicker({
  items,
  baseUrl,
  status,
  defaultUrl,
}: {
  items: DestinationOption[];
  baseUrl: string | null;
  status: "ok" | "not_connected" | "reconnect" | "error";
  defaultUrl: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [domain, setDomain] = useState(baseUrl ?? "");
  const urlOf = (item: DestinationOption) => item.url ?? (item.path && domain ? joinUrl(domain, item.path) : "");
  const initial = items.findIndex((item) => (item.url ?? (item.path && baseUrl ? joinUrl(baseUrl, item.path) : "")) === defaultUrl);
  const [picked, setPicked] = useState<number | null>(items.length ? (initial >= 0 ? initial : null) : null);
  // Nothing in the list matches the default from setup: it stays the address
  // (shown below) until the creator picks something else.
  const [manual, setManual] = useState(initial >= 0 ? "" : defaultUrl);

  // Follow the keyword chosen in step 2 (same form).
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      if (target.name === "keyword" && target.checked) setKeyword(target.value);
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);

  const groups = useMemo(
    () =>
      preferredKinds(keyword)
        .map((kind) => ({ kind, entries: items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind) }))
        .filter((g) => g.entries.length > 0),
    [items, keyword],
  );

  const chosen = picked !== null ? items[picked] : undefined;
  const finalUrl = manual.trim() || (chosen ? urlOf(chosen) : "");
  const needsDomain = Boolean(chosen?.path) && !manual.trim();

  return (
    <div ref={ref} className="grid gap-3">
      <input type="hidden" name="destinationUrl" value={finalUrl} />
      {status === "reconnect" ? (
        <p className="m-0 rounded-md bg-warm-surface p-3 text-[14px] text-warm-text">
          To list your GoHighLevel pages, surveys and calendars, reconnect GoHighLevel once: Settings, GoHighLevel, Disconnect, then Connect GoHighLevel.
          Until then, enter the address under Advanced.
        </p>
      ) : null}
      {status === "error" ? (
        <p className="m-0 rounded-md bg-warm-surface p-3 text-[14px] text-warm-text">GoHighLevel did not answer just now. Enter the address under Advanced, or reload in a minute.</p>
      ) : null}

      {items.length ? (
        <label className="grid gap-1.5">
          <span className="text-[14px] font-semibold">Send them to</span>
          <select
            value={picked ?? ""}
            onChange={(e) => {
              setPicked(e.target.value === "" ? null : Number(e.target.value));
              setManual("");
            }}
            className="h-11 rounded-md border border-border-strong bg-surface px-3 text-[15px]"
          >
            <option value="">Choose a page, survey or calendar</option>
            {groups.map((group) => (
              <optgroup key={group.kind} label={GROUP_LABEL[group.kind]}>
                {group.entries.map(({ item, index }) => (
                  <option key={index} value={index}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}

      {needsDomain ? (
        <label className="grid gap-1.5">
          <span className="text-[14px] font-semibold">Your page domain</span>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://yourdomain.com" className="font-mono" />
          <span className="text-[13px] text-muted-foreground">From your GoHighLevel Sub-account website. Change it if this funnel runs on another domain.</span>
        </label>
      ) : null}

      {finalUrl ? (
        <p className="m-0 text-[14px]">
          Viewers go to:{" "}
          <a href={finalUrl} target="_blank" rel="noopener noreferrer" className="font-mono [overflow-wrap:anywhere]">
            {finalUrl}
          </a>{" "}
          <span className="text-muted-foreground">(open it once to check)</span>
        </p>
      ) : null}

      <details className="rounded-md bg-background p-3 text-[15px]" open={items.length === 0}>
        <summary className="cursor-pointer font-semibold">Advanced: another address</summary>
        <div className="mt-2 grid gap-2">
          <Input
            type="url"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="https://yourdomain.com/guide"
            aria-label="Another address"
            className="font-mono"
          />
          <p className="m-0 text-[13px] text-muted-foreground">
            Outside GoHighLevel we count the clicks, but not what happens on the page, unless that tool sends opt-ins to your inbound endpoint or the sale
            runs through your connected Stripe. Your own link domain for the reply links: <a href="/app/settings/domain">Settings, Linked domain</a>.
          </p>
        </div>
      </details>
    </div>
  );
}
