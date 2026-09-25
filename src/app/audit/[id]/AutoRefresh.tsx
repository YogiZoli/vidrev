"use client";

import { useEffect } from "react";

// The audit runs in the worker; the page asks again every few seconds until
// the result is there.
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), seconds * 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return null;
}
