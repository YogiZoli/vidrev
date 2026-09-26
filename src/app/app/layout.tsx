import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, account } = await requireSession();
  return (
    <AppShell user={user} accountId={account.id}>
      {children}
    </AppShell>
  );
}
