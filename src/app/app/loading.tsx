import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { Page } from "@/components/ui/page";

// Shown while any /app page reads its data.
export default function Loading() {
  return (
    <Page aria-busy="true">
      <Card variant="hero" className="grid gap-4 p-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-14 w-48" />
        <Skeleton className="w-2/3" />
      </Card>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
        {[0, 1].map((i) => (
          <Card key={i} className="grid gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="w-4/5" />
          </Card>
        ))}
      </div>
    </Page>
  );
}
