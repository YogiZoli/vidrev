import type { ReactNode } from "react";
import { PublicShell } from "@/components/shell/PublicShell";

export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
