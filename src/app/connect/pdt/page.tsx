import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";
import { currentSession } from "@/server/auth/current";
import { checkRedirectUri, pdtRedirectOrigins } from "@/server/pdt";
import { productName } from "../../ui";

export const dynamic = "force-dynamic";

// Publishing Dream Team asks to connect (DECISIONS A-30). The creator allows
// or cancels; either way they go back to PDT with a code or error=denied.
export default async function ConnectPdtPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const target = checkRedirectUri(params.redirect_uri, pdtRedirectOrigins());
  const state = (params.state ?? "").slice(0, 500);

  if (!target) {
    return (
      <PublicCard width="sm">
        <Eyebrow>Connect</Eyebrow>
        <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Connect Publishing Dream Team</h1>
        <Notice tone="error">This connect link is not valid, so nothing was connected. Start the connection again from Publishing Dream Team.</Notice>
      </PublicCard>
    );
  }

  const session = await currentSession();
  if (!session) {
    const back = new URLSearchParams({ redirect_uri: target.toString(), state });
    redirect(`/api/connect/pdt/login?${back.toString()}`);
  }

  return (
    <PublicCard width="sm">
      <Eyebrow>Connect</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Connect Publishing Dream Team</h1>
      <p className="m-0 text-base">
        Publishing Dream Team wants to connect to the {productName()} account <strong>{session.user.email}</strong>. It will be able to:
      </p>
      <ul className="m-0 grid gap-1 pl-5 text-base">
        <li>send the publishing card of a new video, and get one tracked link per keyword back</li>
        <li>switch on the keyword automations for that video once it is published</li>
        <li>read how many people commented, subscribed and bought per keyword</li>
      </ul>
      <Meta className="text-[15px]">
        It never sees who commented or what they wrote. Every reply still waits for your approval. A new connection replaces the previous one.
      </Meta>
      <form method="post" action="/api/connect/pdt" className="grid gap-3">
        <input type="hidden" name="redirect_uri" value={target.toString()} />
        <input type="hidden" name="state" value={state} />
        <Button type="submit" name="decision" value="allow" size="lg" pulse>
          Allow
        </Button>
        <Button type="submit" name="decision" value="cancel" variant="outline" size="lg">
          Cancel
        </Button>
      </form>
    </PublicCard>
  );
}
