import { Eyebrow } from "@/components/ui/badge";
import { PublicCard } from "@/components/ui/page";
import { GhlHandshake } from "./GhlHandshake";

export const dynamic = "force-dynamic";

// Custom menu link target inside GoHighLevel (DECISIONS A-22):
// https://app.vidrev.app/ghl
export default function GhlEntryPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <PublicCard width="xs">
        <Eyebrow>vidrev in GoHighLevel</Eyebrow>
        <GhlHandshake />
      </PublicCard>
    </div>
  );
}
