import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Meta, PublicCard } from "@/components/ui/page";
import { foundingCtaUrl } from "@/lib/audit/view";
import { requireSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

// A signed-up account lands here until a checkout activates it. Nothing is
// polled, drafted or sent for it, so it costs no YouTube quota.
export default async function ActivatePage() {
  const { user, account } = await requireSession();
  if (account.status !== "registered") redirect("/app");
  const url = foundingCtaUrl();

  return (
    <PublicCard width="xs">
      <Eyebrow>Almost there</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Activate {productName()}</h1>
      <p className="m-0 text-base text-label">
        Your account is ready. Choose a plan to connect your channel and turn keyword comments into subscribers and buyers.
      </p>
      {url ? (
        <a href={url} className={buttonVariants({ size: "lg" })}>
          Choose a plan
        </a>
      ) : null}
      <Meta className="text-[15px]">
        At checkout use <strong>{user.email}</strong>, so the plan lands on this account. Then come back and sign in again.
      </Meta>
      <form method="post" action="/api/auth/logout">
        <button type="submit" className={buttonVariants({ variant: "ghost" })}>
          Sign out
        </button>
      </form>
    </PublicCard>
  );
}
