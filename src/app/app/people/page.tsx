import Link from "next/link";
import { Badge, Keyword } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Meta, Page, PageHeader } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import type { ContactStage } from "@/db/schema";
import { cn } from "@/lib/cn";
import { requireSession } from "@/server/auth/current";
import { listPeople } from "@/server/people";

export const dynamic = "force-dynamic";

const STAGES: { key: ContactStage | null; label: string }[] = [
  { key: null, label: "Everyone" },
  { key: "commenter", label: "Commenters" },
  { key: "subscriber", label: "Leads" },
  { key: "buyer", label: "Buyers" },
];

const STAGE_BADGE = {
  commenter: { tone: "neutral", label: "Commenter" },
  subscriber: { tone: "primary", label: "Lead" },
  buyer: { tone: "success", label: "Buyer" },
} as const;

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const stage = STAGES.find((s) => s.key === params.stage)?.key ?? null;
  const view = await listPeople(getDb(), account.id, stage);
  const total = view.counts.commenter + view.counts.subscriber + view.counts.buyer;

  return (
    <Page width="lg">
      <PageHeader
        title="People"
        lead="Everyone who commented a trigger keyword. Commenters stay here in vidrev. The moment someone opts in with their email, they become a Lead and go to your CRM with their keyword, video and lead temperature."
      />
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {STAGES.map((s) => {
          const n = s.key ? view.counts[s.key] : total;
          const active = s.key === stage;
          return (
            <Link
              key={s.label}
              href={s.key ? `/app/people?stage=${s.key}` : "/app/people"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-[14px] no-underline",
                active ? "border-primary bg-primary-surface font-bold text-foreground" : "border-border text-label",
              )}
            >
              {s.label} {n}
            </Link>
          );
        })}
      </nav>
      {view.rows.length === 0 ? (
        <EmptyState title="No one here yet">People appear as soon as someone comments a trigger keyword on a live automation.</EmptyState>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                {["Person", "Stage", "Keyword", "Video", "In your CRM", "Last seen"].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((p) => {
                const badge = STAGE_BADGE[p.stage];
                const inCrm = p.stage !== "commenter";
                return (
                  <tr key={p.id}>
                    <Td className="min-w-[200px]">
                      <div className="font-semibold">{p.name ?? "YouTube commenter"}</div>
                      {p.email ? <Meta className="text-[13px]">{p.email}</Meta> : null}
                    </Td>
                    <Td>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </Td>
                    <Td>{p.keyword ? <Keyword temperature={p.intent ?? undefined}>{p.keyword}</Keyword> : "-"}</Td>
                    <Td>
                      {p.videoId ? (
                        <a href={`https://www.youtube.com/watch?v=${p.videoId}`} target="_blank" rel="noreferrer">
                          Open video
                        </a>
                      ) : (
                        "-"
                      )}
                    </Td>
                    <Td>{inCrm ? (view.crmConnected ? "Yes" : "No CRM connected") : "Not yet, waits for opt-in"}</Td>
                    <Td>{day(p.lastSeenAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Meta className="text-[15px]">
        YouTube names show for 30 days at most, then only the keyword and video stay (YouTube API rules). Nothing about a commenter leaves vidrev before
        they opt in.
      </Meta>
    </Page>
  );
}
