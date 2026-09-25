import Script from "next/script";
import { env } from "@/lib/env";
import { Notice, productName, styles } from "../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  origin: "That request did not come from this page. Please try again.",
  rate: "Too many audits from your address in the last hour. Please try again later.",
  human: "We could not confirm you are human. Please try again.",
  server: "Something went wrong. Please try again in a moment.",
};

// Audit my channel (SPEC section 13): free, no sign-in, real numbers only.
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY } = env();
  const turnstile = TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY ? TURNSTILE_SITE_KEY : null;
  const error = params.error === "input" ? (params.msg ?? "Paste your @handle or the channel URL.") : params.error ? ERRORS[params.error] : null;

  return (
    <main style={{ ...styles.main, maxWidth: 560 }}>
      <h1>Audit my channel</h1>
      <p>See what your comments are worth. We read your last 5 videos and tell you, with real numbers, which questions and buying signals went unanswered and whether your links are measured.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form method="post" action="/api/audit" style={{ display: "grid", gap: 12 }}>
        <label htmlFor="channel">Your @handle or channel URL</label>
        <input id="channel" name="channel" required maxLength={300} placeholder="@yourchannel" autoComplete="off" style={styles.input} />
        {turnstile ? <div className="cf-turnstile" data-sitekey={turnstile} /> : null}
        <button type="submit" style={styles.button}>
          Audit my channel
        </button>
      </form>
      {turnstile ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /> : null}
      <p style={styles.muted}>
        Free, no sign-in. Only public data is read, comment text is never stored, and nothing is posted to your channel. {productName()} does not need access to your account for this.
      </p>
    </main>
  );
}
