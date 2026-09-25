import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { currentSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentSession()) redirect("/app");
  const params = await searchParams;

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Brand />
      <h1 className="mt-6 text-3xl">Sign in to {productName()}</h1>
      {params.sent ? (
        <Notice tone="info">If an account exists for that email, a sign-in link is on its way. It works once and expires in 15 minutes.</Notice>
      ) : null}
      {params.error === "expired" ? <Notice tone="error">That sign-in link is invalid or expired. Request a new one.</Notice> : null}
      {params.error === "email" ? <Notice tone="error">Enter a valid email address.</Notice> : null}
      <form method="post" action="/api/auth/magic-link" className="mt-4 grid gap-3">
        <label htmlFor="email" className="text-sm font-semibold">
          Email
        </label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
        <Button type="submit" pulse>
          Email me a sign-in link
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">No password needed. Your account is created when you subscribe.</p>
    </main>
  );
}
