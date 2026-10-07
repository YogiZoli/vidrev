import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";
import { currentSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentSession()) redirect("/app");
  const params = await searchParams;

  return (
    <PublicCard width="xs">
      <Eyebrow>Create account</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Create your {productName()} account</h1>
      {params.sent ? <Notice tone="info">Check your inbox: a sign-in link is on its way. It works once and expires in 15 minutes.</Notice> : null}
      {params.error === "email" ? <Notice tone="error">Enter a valid email address.</Notice> : null}
      {params.error === "busy" ? <Notice tone="error">Too many sign-ups from here. Try again in an hour.</Notice> : null}
      <form method="post" action="/api/auth/signup" className="grid gap-3">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" type="text" autoComplete="name" maxLength={120} large />
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" large />
        <Button type="submit" size="lg" pulse>
          Create account
        </Button>
      </form>
      <Meta className="text-[15px]">
        No password needed: we email you a sign-in link. Already have an account? <Link href="/login">Sign in</Link>
      </Meta>
    </PublicCard>
  );
}
