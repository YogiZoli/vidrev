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

// Step 3 "Where do they go?": picked from the creator's GoHighLevel pages,
// surveys and calendars; nothing to type. The funnel domain is found
// automatically; only when it could not be confirmed is it offered under a
// closed Advanced row. Nothing picked: the default page from setup.
export function DestinationPicker({
  items,
  baseUrl,
  domainVerified,
  status,
  defaultUrl,
}: {
  items: DestinationOption[];
  baseUrl: string | null;
  domainVerified: boolean;
  status: "ok" | "not_connected" | "reconnect" | "error";
  defaultUrl: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [domain, setDomain] = useState(baseUrl ?? "");
  const urlOf = (item: DestinationOption) => item.url ?? (item.path && domain ? joinUrl(domain, item.path) : "");
  const initial = items.findIndex((item) => (item.url ?? (item.path && baseUrl ? joinUrl(baseUrl, item.path) : "")) === defaultUrl);
  const [picked, setPicked] = useState<number | null>(initial >= 0 ? initial : null);

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
  const finalUrl = chosen ? urlOf(chosen) : defaultUrl;
  const showDomain = Boolean(chosen?.path) && !domainVerified;

  return (
    <div ref={ref} className="grid gap-3">
      <input type="hidden" name="destinationUrl" value={finalUrl} />
      {status === "reconnect" ? (
        <p className="m-0 rounded-md bg-warm-surface p-3 text-[14px] text-warm-text">
          To choose from your GoHighLevel pages, surveys and calendars, reconnect GoHighLevel once: Settings, GoHighLevel, Disconnect, then Connect
          GoHighLevel.
        </p>
      ) : null}
      {status === "error" ? (
        <p className="m-0 rounded-md bg-warm-surface p-3 text-[14px] text-warm-text">GoHighLevel did not answer just now. Reload the page in a minute.</p>
      ) : null}

      {items.length ? (
        <label className="grid gap-1.5">
          <span className="text-[14px] font-semibold">Send them to</span>
          <select
            name="destinationPick"
            value={picked ?? ""}
            onChange={(e) => setPicked(e.target.value === "" ? null : Number(e.target.value))}
            className="h-12 rounded-md border border-border-strong bg-surface px-3 text-[15px]"
          >
            <option value="">{defaultUrl ? "Your default page from setup" : "Choose a page, survey or calendar"}</option>
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

      {finalUrl ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          Opens:{" "}
          <a href={finalUrl} target="_blank" rel="noopener noreferrer" className="font-mono [overflow-wrap:anywhere]">
            {finalUrl.replace(/^https?:\/\//, "")}
          </a>
        </p>
      ) : null}

      {showDomain ? (
        <details className="rounded-md bg-background p-3 text-[15px]">
          <summary className="cursor-pointer font-semibold">Advanced: page domain</summary>
          <div className="mt-2 grid gap-1.5">
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://yourdomain.com" aria-label="Page domain" className="font-mono" />
            <span className="text-[13px] text-muted-foreground">We could not confirm on which domain this funnel runs. Change it only if the link above does not open.</span>
          </div>
        </details>
      ) : null}
    </div>
  );
}
