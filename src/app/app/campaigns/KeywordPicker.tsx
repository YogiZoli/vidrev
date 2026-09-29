"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { type CatalogKeyword, DEFAULT_KEYWORD, KEYWORD_CATALOG, misspellings } from "@/lib/keyword-catalog";

// One row per lead temperature: the method at a glance. The row is tinted
// very lightly, each card a little more, the chosen card breathes.
const ROWS = [
  { temperature: "cold", label: "COLD", meaning: "wants a free resource", row: "bg-cold-surface/40", card: "bg-cold-surface/70", text: "text-cold-text", dot: "var(--cold-dot)" },
  { temperature: "warm", label: "WARM", meaning: "wants to learn more", row: "bg-warm-surface/40", card: "bg-warm-surface/70", text: "text-warm-text", dot: "var(--warm-dot)" },
  { temperature: "hot", label: "HOT", meaning: "ready to buy", row: "bg-hot-surface/40", card: "bg-hot-surface/70", text: "text-hot-text", dot: "var(--hot-dot)" },
] as const;

// Step 2 "Which trigger keyword?": pick from the catalog. Misspellings are
// matched automatically; Advanced (closed by default) shows and edits them.
export function KeywordPicker() {
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [aliases, setAliases] = useState(misspellings(DEFAULT_KEYWORD).join(", "));

  function pick(next: string) {
    setKeyword(next);
    setAliases(misspellings(next).join(", "));
  }

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Trigger keyword" className="grid gap-2.5">
        {ROWS.map((row) => {
          const words = KEYWORD_CATALOG.filter((k) => k.temperature === row.temperature);
          return (
            <div key={row.temperature} className={cn("grid gap-2 rounded-lg p-2.5 md:grid-cols-[108px_minmax(0,1fr)] md:items-center", row.row)}>
              <div className="grid gap-0.5 px-1">
                <span className={cn("flex items-center gap-2 text-[20px] font-extrabold tracking-[0.06em]", row.text)}>
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: row.dot }} />
                  {row.label}
                </span>
                <span className={cn("text-[12px] font-semibold", row.text)}>{row.meaning}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {words.map((k: CatalogKeyword) => {
                  const selected = keyword === k.keyword;
                  return (
                    <label
                      key={k.keyword}
                      style={{ ["--kw" as string]: row.dot }}
                      className={cn(
                        "grid min-h-[68px] cursor-pointer content-center gap-1 rounded-md border-2 px-2.5 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        row.card,
                        selected ? "kw-selected border-[var(--kw)] bg-surface" : "border-transparent hover:border-[var(--kw)]",
                      )}
                    >
                      <input type="radio" name="keyword" value={k.keyword} checked={selected} onChange={() => pick(k.keyword)} className="sr-only" />
                      <span className="font-mono text-[15px] font-bold">{k.keyword}</span>
                      <span className="text-[12px] leading-tight text-label">{k.gets}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <details className="rounded-md bg-background p-3 text-[15px]">
        <summary className="cursor-pointer font-semibold">Advanced: misspellings and your own keyword</summary>
        <p className="mb-2 mt-2 text-[13px] text-muted-foreground">
          Comments with these spellings count as {keyword} too. Filled in automatically; edit if you like (comma separated).
        </p>
        <Textarea name="aliases" rows={2} value={aliases} onChange={(e) => setAliases(e.target.value)} aria-label="Misspellings" className="font-mono" />
        <p className="mb-0 mt-3 text-[13px] text-muted-foreground">
          <strong className="text-label">Your own keyword:</strong> coming soon.
        </p>
      </details>
    </div>
  );
}
