import { productName, styles } from "../../ui";

export const dynamic = "force-dynamic";

// Opening the emailed link shows this button; the token is consumed only on
// POST, so mail scanners that prefetch links do not use it up.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await searchParams;
  return (
    <main style={{ ...styles.main, maxWidth: 420 }}>
      <h1>Sign in to {productName()}</h1>
      {token ? (
        <form method="post" action="/api/auth/verify">
          <input type="hidden" name="token" value={token} />
          <button type="submit" style={styles.button}>
            Continue
          </button>
        </form>
      ) : (
        <p>
          This link is incomplete. <a href="/login">Request a new sign-in link.</a>
        </p>
      )}
    </main>
  );
}
