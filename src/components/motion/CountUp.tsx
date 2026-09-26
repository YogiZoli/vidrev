"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

// Count-up on every revenue and metric figure: ease-out cubic, then one
// `num-pop` when it lands. The server renders the final value, so the page is
// right without JavaScript and for prefers-reduced-motion (no animation).
export function CountUp({
  value,
  currency,
  duration = 1400,
  className,
}: {
  value: number;
  // Set for money: `value` is minor units and is shown through formatMoney.
  currency?: string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const [popped, setPopped] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || value <= 0) return;
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let from = 0;
    const tick = (now: number) => {
      if (!from) from = now;
      const t = Math.min(1, (now - from) / duration);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setPopped(true);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className={cn("inline-block origin-left", popped && "animate-num-pop", className)}>
      {currency ? formatMoney(shown, currency) : shown.toLocaleString("en-US")}
    </span>
  );
}
