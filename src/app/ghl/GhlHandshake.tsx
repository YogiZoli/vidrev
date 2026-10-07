"use client";

import { useEffect, useState } from "react";

type State = "waiting" | "outside" | "not_connected" | "no_location" | "error";

const TEXT: Record<Exclude<State, "waiting">, string> = {
  outside: "Open vidrev from the menu inside GoHighLevel to sign in automatically.",
  not_connected: "This sub-account is not connected to vidrev yet.",
  no_location: "Open a sub-account in GoHighLevel first, then vidrev again.",
  error: "Signing in from GoHighLevel did not work. Reload the page, or log in directly.",
};

// Asks GoHighLevel (the parent frame) for the signed-in user, hands the
// encrypted answer to the server and continues to the app.
export function GhlHandshake() {
  const [state, setState] = useState<State>("waiting");

  useEffect(() => {
    if (window.parent === window) {
      const id = window.setTimeout(() => setState("outside"), 0);
      return () => window.clearTimeout(id);
    }
    const timer = window.setTimeout(() => setState((s) => (s === "waiting" ? "outside" : s)), 6000);
    const onMessage = async (event: MessageEvent) => {
      const data = event.data as { message?: string; payload?: string } | null;
      if (!data || data.message !== "REQUEST_USER_DATA_RESPONSE" || !data.payload) return;
      window.clearTimeout(timer);
      try {
        const response = await fetch("/api/ghl/sso", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ payload: data.payload }),
        });
        const result = (await response.json()) as { ok: boolean; next?: string; reason?: string };
        if (result.ok && result.next) window.location.replace(result.next);
        else setState(result.reason === "not_connected" || result.reason === "no_location" ? result.reason : "error");
      } catch {
        setState("error");
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, []);

  if (state === "waiting") return <p className="m-0 text-base text-label">Signing you in from GoHighLevel...</p>;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-base">{TEXT[state]}</p>
      {state === "not_connected" || state === "outside" || state === "error" ? (
        <div className="flex flex-wrap gap-2">
          <a href="/signup" target="_blank" rel="noopener" className="font-semibold">
            Create a vidrev account
          </a>
          <span className="text-muted-foreground">or</span>
          <a href="/login" target="_blank" rel="noopener" className="font-semibold">
            Log in
          </a>
        </div>
      ) : null}
      {state === "not_connected" ? (
        <p className="m-0 text-[15px] text-label">
          Then, in vidrev, connect this GoHighLevel sub-account (Settings, GoHighLevel). Come back here and reload: you are in.
        </p>
      ) : null}
    </div>
  );
}
