import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Meta, PublicCard } from "@/components/ui/page";

export const dynamic = "force-dynamic";

// Where a failed form post lands (src/server/route-guard.ts): what happened,
// what to do, and the reference that finds the log line.
export default async function OopsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const ref = /^[0-9a-f]{8}$/.test(params.ref ?? "") ? params.ref : null;
  const back = params.back?.startsWith("/") && !params.back.startsWith("//") ? params.back : "/app";
  return (
    <PublicCard width="md">
      <h1 className="m-0 text-[28px] font-bold leading-tight">That did not go through.</h1>
      <p className="m-0 text-base text-label">
        Something went wrong on our side and your last action was not saved. Nothing you did caused this. Go back and try once more; if it keeps happening, send us the
        reference below and we will find exactly what failed.
      </p>
      {ref ? (
        <Meta className="text-sm">
          Reference: <code className="font-mono">{ref}</code>
        </Meta>
      ) : null}
      <div>
        <Button asChild>
          <Link href={back}>Go back</Link>
        </Button>
      </div>
    </PublicCard>
  );
}
