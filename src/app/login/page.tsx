import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleButton, OrDivider } from "@/components/auth/GoogleButton";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";
import { currentSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Wrong email or password.",
  busy: "Too many tries. Wait 15 minutes, or reset your password.",
  expired: "That link is invalid or expired.",
  google: "Google sign-in did not finish. Try again.",
  google_unverified: "Your Google email is not verified. Use email and password instead.",
  server: "Something went wrong. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentSession()) redirect("/app");
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : null;

  return (
    <PublicCard width="xs">
      <Eyebrow>Log in</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Log in to {productName()}</h1>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <GoogleButton from="login" />
      <OrDivider />
      <form method="post" action="/api/auth/login" className="grid gap-3">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" large />
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot" className="text-[14px]">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" required autoComplete="current-password" large />
        <Button type="submit" size="lg" pulse>
          Log in
        </Button>
      </form>
      <Meta className="text-[15px]">
        New here? <Link href="/signup">Create an account</Link>
      </Meta>
    </PublicCard>
  );
}
