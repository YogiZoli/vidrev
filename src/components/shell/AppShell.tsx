import { and, count, eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { campaigns, replies } from "@/db/schema";
import { isAdminEmail } from "@/server/auth/current";
import { BottomTabs, TopTabs } from "./AppNav";

// Signed-in shell: sticky translucent header with the gradient hairline, logo,
// email and Sign out, underline tabs from md up, bottom tab bar on phones.
export async function AppShell({ user, accountId, children }: { user: { email: string }; accountId: string; children: ReactNode }) {
  const [pending] = await getDb()
    .select({ n: count() })
    .from(replies)
    .where(and(eq(replies.accountId, accountId), eq(replies.status, "pending_approval")));
  const queueCount = pending?.n ?? 0;
  const [live] = await getDb()
    .select({ n: count() })
    .from(campaigns)
    .where(and(eq(campaigns.accountId, accountId), eq(campaigns.active, true)));
  const liveCount = live?.n ?? 0;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-white/85 backdrop-blur-md">
        <div aria-hidden className="h-0.5 [background:var(--hairline)]" />
        <div className="mx-auto grid max-w-[var(--container)] gap-2 px-4 pb-3 pt-3 md:pb-0">
          <div className="flex items-center justify-between gap-3">
            <Brand size={28} />
            <div className="flex min-w-0 items-center gap-3">
              <span className="truncate text-sm text-muted-foreground">{user.email}</span>
              <form method="post" action="/api/auth/logout">
                <Button type="submit" variant="outline" size="sm" className="flex-none">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
          <TopTabs queueCount={queueCount} liveCount={liveCount} isAdmin={isAdminEmail(user.email)} />
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <BottomTabs queueCount={queueCount} liveCount={liveCount} />
    </div>
  );
}
