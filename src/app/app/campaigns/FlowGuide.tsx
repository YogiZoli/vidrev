"use client";

import { useEffect, useRef } from "react";

// Leads the eye through New automation: when a step is answered, the next
// one scrolls into view and glows once. Steps 1 and 3 have good defaults, so
// the page opens with the trigger keyword (the real decision) glowing.
const NEXT: Record<string, string> = { keyword: "step-destination", destinationPick: "step-go" };

function glow(id: string, scroll: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  if (scroll) el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("step-glow");
  // Restart the animation even when the same step glows twice.
  void el.offsetWidth;
  el.classList.add("step-glow");
}

export function FlowGuide() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const first = window.setTimeout(() => glow("step-keyword", false), 600);
    const onChange = (event: Event) => {
      const name = (event.target as HTMLInputElement).name;
      const next = NEXT[name];
      if (next) window.setTimeout(() => glow(next, true), 250);
    };
    form.addEventListener("change", onChange);
    return () => {
      window.clearTimeout(first);
      form.removeEventListener("change", onChange);
    };
  }, []);
  return <span ref={ref} hidden />;
}
