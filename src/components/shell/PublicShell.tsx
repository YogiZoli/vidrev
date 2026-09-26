import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { currentSession } from "@/server/auth/current";

// Public pages (/login, /audit, /connect/crm): logo plus one outline button;
// each page centres its own content.
export async function PublicShell({ children }: { children: ReactNode }) {
  const signedIn = Boolean(await currentSession());
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[var(--container)] items-center justify-between px-4 py-4">
        <Link href="/" className="no-underline">
          <Brand size={28} />
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href={signedIn ? "/app" : "/login"}>{signedIn ? "Open your dashboard" : "Sign in"}</Link>
        </Button>
      </header>
      {children}
    </div>
  );
}
