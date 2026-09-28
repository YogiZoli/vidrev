import type { ReactNode } from "react";
import { PublicShell } from "@/components/shell/PublicShell";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// Onboarding: the app is locked, so the header offers Sign out, not the dashboard.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <PublicShell
      action={
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      }
    >
      {children}
    </PublicShell>
  );
}
