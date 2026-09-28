"use client";

import { useState } from "react";
import { TemperatureChip } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { DEFAULT_KEYWORD, KEYWORD_CATALOG, misspellings } from "@/lib/keyword-catalog";

// Step 2: pick a keyword from the catalog. Its misspellings are filled in
// automatically; Advanced (closed by default) shows and edits them.
export function KeywordPicker() {
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [aliases, setAliases] = useState(misspellings(DEFAULT_KEYWORD).join(", "));

  function pick(next: string) {
    setKeyword(next);
    setAliases(misspellings(next).join(", "));
  }

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Keyword" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {KEYWORD_CATALOG.map((k) => (
          <label
            key={k.keyword}
            className={cn(
              "grid cursor-pointer gap-1.5 rounded-md border bg-surface p-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              keyword === k.keyword ? "border-primary shadow-[0_0_0_1px_var(--primary-600)]" : "border-border hover:border-border-strong",
            )}
          >
            <input type="radio" name="keyword" value={k.keyword} checked={keyword === k.keyword} onChange={() => pick(k.keyword)} className="sr-only" />
            <span className="font-mono text-[15px] font-bold">{k.keyword}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <TemperatureChip temperature={k.temperature} />
              <span className="text-[12px] text-muted-foreground">{k.gets}</span>
            </span>
          </label>
        ))}
        <div className="grid gap-1.5 rounded-md border border-dashed border-border p-2.5 text-muted-foreground" aria-disabled>
          <span className="text-[15px] font-bold">Your own keyword</span>
          <span className="text-[12px]">Coming soon</span>
        </div>
      </div>
      <details className="rounded-md bg-background p-3 text-[15px]">
        <summary className="cursor-pointer font-semibold">Advanced: misspellings</summary>
        <p className="mb-2 mt-2 text-[13px] text-muted-foreground">
          Comments with these spellings count as {keyword} too. Filled in automatically; edit if you like (comma separated).
        </p>
        <Textarea name="aliases" rows={2} value={aliases} onChange={(e) => setAliases(e.target.value)} aria-label="Misspellings" className="font-mono" />
      </details>
    </div>
  );
}
