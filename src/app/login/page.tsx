import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";
import { currentSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentSession()) redirect("/app");
  const params = await searchParams;

  return (
    <PublicCard width="xs">
      <Eyebrow>Sign in</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Sign in to {productName()}</h1>
      {params.sent ? (
        <Notice tone="info">If an account exists for that email, a sign-in link is on its way. It works once and expires in 15 minutes.</Notice>
      ) : null}
      {params.error === "expired" ? <Notice tone="error">That sign-in link is invalid or expired. Request a new one.</Notice> : null}
      {params.error === "email" ? <Notice tone="error">Enter a valid email address.</Notice> : null}
      <form method="post" action="/api/auth/magic-link" className="grid gap-3">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" large />
        <Button type="submit" size="lg" pulse>
          Email me a sign-in link
        </Button>
      </form>
      <Meta className="text-[15px]">No password needed. Your account is created when you subscribe.</Meta>
    </PublicCard>
  );
}
