import type { ReactNode } from "react";
import { SettingsSideNav } from "@/components/shell/SettingsSideNav";

// Settings pages share a grouped side menu (a list above the page on phones).
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-2 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 md:px-4">
      <SettingsSideNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
