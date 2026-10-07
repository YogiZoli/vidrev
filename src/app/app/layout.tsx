import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, account } = await requireSession();
  // A signed-up account waits for its checkout (DECISIONS A-15).
  if (account.status === "registered") redirect("/activate");
  // The app is locked until onboarding is complete (Phase 14).
  if (!account.onboardedAt) redirect("/onboarding");
  return (
    <AppShell user={user} accountId={account.id}>
      {children}
    </AppShell>
  );
}
