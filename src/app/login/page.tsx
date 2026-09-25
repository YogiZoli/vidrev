import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/current";
import { Notice, productName, styles } from "../ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentSession()) redirect("/app");
  const params = await searchParams;

  return (
    <main style={{ ...styles.main, maxWidth: 420 }}>
      <h1>Sign in to {productName()}</h1>
      {params.sent ? (
        <Notice tone="info">If an account exists for that email, a sign-in link is on its way. It works once and expires in 15 minutes.</Notice>
      ) : null}
      {params.error === "expired" ? <Notice tone="error">That sign-in link is invalid or expired. Request a new one.</Notice> : null}
      {params.error === "email" ? <Notice tone="error">Enter a valid email address.</Notice> : null}
      <form method="post" action="/api/auth/magic-link" style={{ display: "grid", gap: 12 }}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" style={styles.input} />
        <button type="submit" style={styles.button}>
          Email me a sign-in link
        </button>
      </form>
      <p style={styles.muted}>No password needed. Your account is created when you subscribe.</p>
    </main>
  );
}
