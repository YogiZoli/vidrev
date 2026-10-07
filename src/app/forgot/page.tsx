import Link from "next/link";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";

export const dynamic = "force-dynamic";

// Also the way in for accounts made at checkout, which have no password yet.
export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return (
    <PublicCard width="xs">
      <Eyebrow>Password</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Set a new password</h1>
      {params.sent ? <Notice tone="info">If an account exists for that email, a link to set a new password is on its way. It expires in 15 minutes.</Notice> : null}
      {params.error === "email" ? <Notice tone="error">Enter a valid email address.</Notice> : null}
      {params.error === "expired" ? <Notice tone="error">That link is invalid or expired. Ask for a new one.</Notice> : null}
      <form method="post" action="/api/auth/forgot" className="grid gap-3">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" large />
        <Button type="submit" size="lg">
          Email me a link
        </Button>
      </form>
      <Meta className="text-[15px]">
        <Link href="/login">Back to log in</Link>
      </Meta>
    </PublicCard>
  );
}
