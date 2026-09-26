import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { auditOverview, listAccountsForAdmin, listPlans } from "@/server/admin";
import { requireAdmin } from "@/server/auth/current";
import { auditUnitsLeft } from "@/server/quota";
import { Notice } from "../ui";

export const dynamic = "force-dynamic";

// Owner console (DECISIONS Q-21), limited to ADMIN_EMAILS.
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const { msg } = await searchParams;
  const db = getDb();
  const auditLimit = env().AUDIT_DAILY_LIMIT;
  const [accountRows, planRows, audit, auditLeft] = await Promise.all([listAccountsForAdmin(db), listPlans(db), auditOverview(db), auditUnitsLeft(db, auditLimit)]);
  const founding = accountRows.filter((a) => a.planCode === "founding").length;
  const foundingCap = planRows.find((p) => p.code === "founding")?.seatsCap ?? 100;

  const planSelect = (name: string, selected?: string) => (
    <Select name={name} defaultValue={selected} className="w-auto min-w-40" aria-label="Plan">
      {planRows.map((p) => (
        <option key={p.code} value={p.code}>
          {p.code}
        </option>
      ))}
    </Select>
  );

  return (
    <Page width="xl">
      <PageHeader title="Owner admin" />
      {msg ? <Notice tone="info">{msg}</Notice> : null}

      <Card className="grid gap-3">
        <SectionTitle>Grant access</SectionTitle>
        <Meta className="text-[15px]">Creates the account (or updates its plan) and emails a sign-in link. Use it for partner access (ghl_affiliate_free).</Meta>
        <form method="post" action="/api/admin" className="flex flex-wrap gap-2">
          <input type="hidden" name="kind" value="grant" />
          <Input name="email" type="email" required placeholder="email" aria-label="Email" className="w-full sm:w-[280px]" />
          {planSelect("planCode", "ghl_affiliate_free")}
          <Button type="submit" pulse>
            Grant
          </Button>
        </form>
      </Card>

      <section className="grid gap-3">
        <SectionTitle>Accounts</SectionTitle>
        <Meta className="text-[15px]">
          Founding seats: {founding} of {foundingCap}. Total accounts: {accountRows.length}.
        </Meta>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Plan</Th>
                <Th>Channels</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {accountRows.map((a) => (
                <tr key={a.accountId}>
                  <Td className="[overflow-wrap:anywhere]">{a.email}</Td>
                  <Td>
                    <Badge tone={a.status === "active" ? "success" : "danger"}>{a.status}</Badge>
                    {a.trialEndsAt ? <span className="ml-1.5 text-[13px] text-muted-foreground">trial to {a.trialEndsAt.toISOString().slice(0, 10)}</span> : null}
                  </Td>
                  <Td>
                    <form method="post" action="/api/admin" className="flex gap-1.5">
                      <input type="hidden" name="kind" value="set_plan" />
                      <input type="hidden" name="accountId" value={a.accountId} />
                      {planSelect("planCode", a.planCode)}
                      <Button type="submit" variant="outline" size="sm">
                        Save
                      </Button>
                    </form>
                  </Td>
                  <Td>{a.liveChannels}</Td>
                  <Td className="whitespace-nowrap font-mono text-[13px]">{a.createdAt.toISOString().slice(0, 10)}</Td>
                  <Td>
                    <div className="grid gap-1.5">
                      <form method="post" action="/api/admin">
                        <input type="hidden" name="kind" value={a.status === "active" ? "suspend" : "unsuspend"} />
                        <input type="hidden" name="accountId" value={a.accountId} />
                        <Button type="submit" variant="outline" size="sm">
                          {a.status === "active" ? "Suspend" : "Reactivate"}
                        </Button>
                      </form>
                      <form method="post" action="/api/admin">
                        <input type="hidden" name="kind" value={a.fallbackLinksBlocked ? "unblock_links" : "block_links"} />
                        <input type="hidden" name="accountId" value={a.accountId} />
                        <Button type="submit" variant="outline" size="sm">
                          {a.fallbackLinksBlocked ? "Allow fallback links" : "Block fallback links"}
                        </Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </section>

      <section className="grid gap-3">
        <SectionTitle>Audit my channel</SectionTitle>
        <Meta className="text-[15px]">
          Last 7 days: {audit.requests} audits requested, {audit.done} finished, {audit.reports} full reports requested. Audit quota today: {auditLimit - auditLeft} of {auditLimit} units used.
        </Meta>
        {audit.recent.length === 0 ? (
          <Meta className="text-[15px]">No report requests yet.</Meta>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Channel</Th>
                  <Th>Score</Th>
                  <Th>Stack</Th>
                  <Th>Marketing consent</Th>
                  <Th>Requested</Th>
                </tr>
              </thead>
              <tbody>
                {audit.recent.map((r, i) => (
                  <tr key={`${r.email}-${i}`}>
                    <Td className="[overflow-wrap:anywhere]">{r.email}</Td>
                    <Td>{r.channel}</Td>
                    <Td>{r.score ?? "-"}</Td>
                    <Td>{r.segment ?? "-"}</Td>
                    <Td>{r.marketing ? "yes" : "no"}</Td>
                    <Td className="whitespace-nowrap font-mono text-[13px]">{r.at ? r.at.toISOString().slice(0, 16).replace("T", " ") : "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </section>
    </Page>
  );
}
