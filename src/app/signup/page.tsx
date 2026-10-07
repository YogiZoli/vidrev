import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleButton, OrDivider } from "@/components/auth/GoogleButton";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";
import { PASSWORD_MIN } from "@/lib/password";
import { currentSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  password: `Use a password of at least ${PASSWORD_MIN} characters.`,
  exists: "There is already an account with this email. Log in instead.",
  busy: "Too many sign-ups from here. Try again in an hour.",
  google: "Google sign-up did not finish. Try again.",
  google_unverified: "Your Google email is not verified. Use email and password instead.",
  server: "Something went wrong. Try again.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentSession()) redirect("/app");
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : null;

  return (
    <PublicCard width="xs">
      <Eyebrow>Get started</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Create your {productName()} account</h1>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <GoogleButton from="signup" />
      <Meta className="-mt-1 text-[13px]">Use the Google account of your YouTube channel.</Meta>
      <OrDivider />
      <form method="post" action="/api/auth/signup" className="grid gap-3">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" type="text" autoComplete="name" maxLength={120} large />
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" large />
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" large />
        <Button type="submit" size="lg" pulse>
          Create account
        </Button>
      </form>
      <Meta className="text-[15px]">
        Already have an account? <Link href="/login">Log in</Link>
      </Meta>
    </PublicCard>
  );
}
