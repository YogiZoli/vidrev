import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { currentSession } from "@/server/auth/current";

// Public pages (/login, /signup, the audit, /connect/crm): logo plus Log in and Get started;
// each page centres its own content.
export async function PublicShell({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const signedIn = Boolean(await currentSession());
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[var(--container)] items-center justify-between px-4 py-4">
        <Link href="/" className="no-underline">
          <Brand size={28} />
        </Link>
        {action ??
          (signedIn ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/app">Open your dashboard</Link>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </div>
          ))}
      </header>
      {children}
    </div>
  );
}
