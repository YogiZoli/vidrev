import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Shared bits of the integration pages under Settings.
export { formatUtcMinute as when } from "@/lib/time";

export function Mono({ children }: { children: ReactNode }) {
  return <code className="break-all font-mono text-[13px]">{children}</code>;
}

// One small POST button per action.
export function ActionForm({ action, id, children, name = "id" }: { action: string; id?: string; children: ReactNode; name?: string }) {
  return (
    <form method="post" action="/api/integrations">
      <input type="hidden" name="action" value={action} />
      {id ? <input type="hidden" name={name} value={id} /> : null}
      <Button type="submit" variant="outline" size="sm">
        {children}
      </Button>
    </form>
  );
}
