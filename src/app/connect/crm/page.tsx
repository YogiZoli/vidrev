import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { env, requireEnv } from "@/lib/env";
import { verifySignedValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE } from "@/server/ghl/config";
import { hasPendingInstall } from "@/server/ghl/install";
import { Notice, productName, styles } from "../../ui";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  denied: "The permission was not granted in HighLevel, so nothing was connected.",
  expired: "This install link has expired. Start the install again from HighLevel.",
  failed: "Connecting failed. Start the install again from HighLevel.",
  unavailable: "Connecting is not available yet.",
  not_location: "Install the app on one sub-account (location), not on the whole agency.",
  location_taken: "This sub-account is already connected to another account here.",
  already_connected: "Another HighLevel sub-account is already connected to your account. Disconnect it first on the Integrations page.",
  suspended: "Your account is suspended, so nothing can be connected.",
};

// Where a Marketplace install lands when the installer is not signed in yet
// (DECISIONS P10-01). The grant waits here for 24 hours; whoever holds the
// claim cookie of the installing browser can attach it to their account.
export default async function ConnectCrmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error } = await searchParams;
  const session = await currentSession();
  const claim = verifySignedValue<{ token: string }>((await cookies()).get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  const pending = claim ? await hasPendingInstall(getDb(), claim.token) : false;
  const brand = env().BRAND_BASE_URL;

  return (
    <main style={{ ...styles.main, maxWidth: 520 }}>
      <h1>Connect your HighLevel sub-account</h1>
      {error ? <Notice tone="error">{MESSAGES[error] ?? MESSAGES.failed}</Notice> : null}

      {pending && session ? (
        <>
          <p>
            HighLevel is ready to connect to {productName()}. It will be attached to the account <strong>{session.user.email}</strong>.
          </p>
          <form method="post" action="/api/oauth/crm/claim">
            <button type="submit" style={styles.button}>
              Connect to this account
            </button>
          </form>
        </>
      ) : null}

      {pending && !session ? (
        <>
          <p>The install worked. One step is left: sign in to your {productName()} account so we know where to connect it.</p>
          <p>
            <a href="/login" style={{ ...styles.button, textDecoration: "none", display: "inline-block" }}>
              Sign in
            </a>
          </p>
          <p style={styles.muted}>
            Open the sign-in link in this same browser, then this connection is offered on your dashboard. It waits for 24 hours.
            {brand ? (
              <>
                {" "}
                No account yet? <a href={brand}>Get {productName()}</a>, then come back to this browser.
              </>
            ) : null}
          </p>
        </>
      ) : null}

      {!pending && !error ? (
        <p>
          Nothing is waiting to be connected. To connect HighLevel, {session ? <a href="/app/integrations">open Integrations</a> : <a href="/login">sign in</a>} and press
          Connect, or install the app again from HighLevel.
        </p>
      ) : null}
    </main>
  );
}
