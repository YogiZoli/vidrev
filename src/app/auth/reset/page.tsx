import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PublicCard } from "@/components/ui/page";
import { PASSWORD_MIN } from "@/lib/password";

export const dynamic = "force-dynamic";

// The token is used only on POST, so mail scanners that open the link do not burn it.
export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token, error } = await searchParams;
  return (
    <PublicCard width="xs">
      <Eyebrow>Password</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Choose your password</h1>
      {error === "password" ? <Notice tone="error">Use at least {PASSWORD_MIN} characters.</Notice> : null}
      {token ? (
        <form method="post" action="/api/auth/reset" className="grid gap-3">
          <input type="hidden" name="token" value={token} />
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" large />
          <Button type="submit" size="lg" pulse>
            Save and log in
          </Button>
        </form>
      ) : (
        <p className="m-0 text-base">
          This link is incomplete. <a href="/forgot">Ask for a new one.</a>
        </p>
      )}
    </PublicCard>
  );
}
