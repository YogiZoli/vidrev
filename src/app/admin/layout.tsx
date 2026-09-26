import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireAdmin } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, account } = await requireAdmin();
  return (
    <AppShell user={user} accountId={account.id}>
      {children}
    </AppShell>
  );
}
