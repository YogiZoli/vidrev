import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PublicCard } from "@/components/ui/page";
import { productName } from "../../ui";

export const dynamic = "force-dynamic";

// Opening the emailed link shows this button; the token is consumed only on
// POST, so mail scanners that prefetch links do not use it up.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await searchParams;
  return (
    <PublicCard width="xs">
      <Eyebrow>Sign in</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Sign in to {productName()}</h1>
      {token ? (
        <form method="post" action="/api/auth/verify" className="grid">
          <input type="hidden" name="token" value={token} />
          <Button type="submit" size="lg" pulse>
            Continue
          </Button>
        </form>
      ) : (
        <p className="m-0 text-base">
          This link is incomplete. <a href="/login">Request a new sign-in link.</a>
        </p>
      )}
    </PublicCard>
  );
}
