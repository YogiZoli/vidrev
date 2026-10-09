import { cookies } from "next/headers";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meta, PublicCard } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { env, requireEnv } from "@/lib/env";
import { verifySignedValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE } from "@/server/ghl/config";
import { hasPendingInstall } from "@/server/ghl/install";
import { returnPath } from "@/server/onboarding";
import { Notice, productName } from "../../ui";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  denied: "The permission was not granted, so nothing was connected. To try again, install the app again from your CRM.",
  expired: "This install link has expired. Install the app again from your CRM.",
  failed: "Connecting failed on our side. Install the app again from your CRM. If it fails again, write to support and quote the time.",
  unavailable: "Connecting is not available yet.",
  not_location: "Install the app on one sub-account (location), not on the whole agency.",
  location_taken: "This sub-account is already connected to another account here. Sign in with that account, or ask its owner to disconnect it.",
  already_connected:
    "Your account already has a sub-account connected, and each account connects one. To connect this sub-account, sign out and sign in with a different account, or disconnect the current one first in Settings.",
  suspended: "Your account is suspended, so nothing can be connected.",
};

// Every text on this page stays free of the platform name: it is where the
// Marketplace install lands (DECISIONS A-24).

// Where a Marketplace install lands when the installer is not signed in yet
// (DECISIONS P10-01). The grant waits here for 24 hours; whoever holds the
// claim cookie of the installing browser can attach it to their account.
export default async function ConnectCrmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error, connected } = await searchParams;
  const session = await currentSession();
  const claim = verifySignedValue<{ token: string }>((await cookies()).get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  const pending = claim ? await hasPendingInstall(getDb(), claim.token) : false;
  const brand = env().BRAND_BASE_URL;

  return (
    <PublicCard width="sm">
      <Eyebrow>Connect</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Connect your CRM sub-account</h1>
      {error ? <Notice tone="error">{MESSAGES[error] ?? MESSAGES.failed}</Notice> : null}

      {connected && session ? (
        <>
          <p className="m-0 text-base">
            Your sub-account is connected to {productName()} (account <strong>{session.user.email}</strong>). We are setting up the tracking field and reading your contacts now; this
            runs on its own, you can close this page.
          </p>
          <Button asChild size="lg" pulse>
            <a href={returnPath(session.account, "/app")}>Open {productName()}</a>
          </Button>
        </>
      ) : null}

      {connected && !session ? (
        <p className="m-0 text-base">
          The app was installed again and your sub-account stays connected to its {productName()} account. <a href="/login">Sign in</a> to see it.
        </p>
      ) : null}

      {pending && session ? (
        <>
          <p className="m-0 text-base">
            Your sub-account is ready to connect to {productName()}. It will be attached to the account <strong>{session.user.email}</strong>.
          </p>
          <form method="post" action="/api/oauth/crm/claim" className="grid">
            <Button type="submit" size="lg" pulse>
              Connect to this account
            </Button>
          </form>
        </>
      ) : null}

      {pending && !session ? (
        <>
          <p className="m-0 text-base">The install worked. One step is left: sign in to your {productName()} account so we know where to connect it.</p>
          <Button asChild size="lg" pulse>
            <a href="/login">Sign in</a>
          </Button>
          <Meta className="text-[15px]">
            Open the sign-in link in this same browser, then this connection is offered on your dashboard. It waits for 24 hours.
            {brand ? (
              <>
                {" "}
                No account yet? <a href={brand}>Get {productName()}</a>, then come back to this browser.
              </>
            ) : null}
          </Meta>
        </>
      ) : null}

      {!pending && !error && !connected ? (
        <p className="m-0 text-base">
          Nothing is waiting to be connected. Install the app again from your CRM, or {session ? <a href={returnPath(session.account, "/app")}>open {productName()}</a> : <a href="/login">sign in</a>}.
        </p>
      ) : null}
    </PublicCard>
  );
}
