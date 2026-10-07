import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { listCoupons } from "@/server/access";
import { auditOverview, listAccountsForAdmin, listPlans } from "@/server/admin";
import { requireAdmin } from "@/server/auth/current";
import { auditUnitsLeft } from "@/server/quota";
import { systemHealth } from "@/server/system-health";
import { prospectOverview } from "@/server/prospects-admin";
import { Notice } from "../ui";
import { SystemHealthCard } from "./SystemHealthCard";

export const dynamic = "force-dynamic";

const ACCESS_LABEL = {
  checkout: "checkout",
  trial: "trial",
  coupon: "coupon",
  partner_snapshot: "GHL affiliate snapshot",
  partner_admin: "owner grant",
} as const;

// Owner console (DECISIONS Q-21), limited to ADMIN_EMAILS.
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const { msg } = await searchParams;
  const db = getDb();
  const auditLimit = env().AUDIT_DAILY_LIMIT;
  const [accountRows, planRows, audit, auditLeft, health, couponRows, prospects] = await Promise.all([
    listAccountsForAdmin(db),
    listPlans(db),
    auditOverview(db),
    auditUnitsLeft(db, auditLimit),
    systemHealth(db),
    listCoupons(db),
    prospectOverview(db),
  ]);
  const backupOf = new Map(prospects.backups.map((b) => [b.prospectId, b]));
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
      <SystemHealthCard health={health} />

      <Card className="grid gap-3">
        <SectionTitle>Grant access</SectionTitle>
        <Meta className="text-[15px]">Creates the account (or updates its plan) and emails a sign-in link. Use it for partner access (ghl_affiliate_free), for example when your GoHighLevel affiliate dashboard shows a referral the snapshot did not catch.</Meta>
        <form method="post" action="/api/admin" className="flex flex-wrap gap-2">
          <input type="hidden" name="kind" value="grant" />
          <Input name="email" type="email" required placeholder="email" aria-label="Email" className="w-full sm:w-[280px]" />
          {planSelect("planCode", "ghl_affiliate_free")}
          <Button type="submit" pulse>
            Grant
          </Button>
        </form>
      </Card>

      <Card className="grid gap-3">
        <SectionTitle>Coupon codes</SectionTitle>
        <Meta className="text-[15px]">
          Partner: free for good (Partner access). Trial: full access for the given days, once per account. Give a code to anyone who got stuck or deserves a make-good;
          they enter it on the activation page.
        </Meta>
        <form method="post" action="/api/admin" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value="create_coupon" />
          <Input name="code" required placeholder="CODE" aria-label="Code" className="w-40 uppercase" />
          <Select name="couponKind" defaultValue="trial" className="w-auto" aria-label="Kind">
            <option value="trial">trial</option>
            <option value="partner">partner</option>
          </Select>
          <Input name="days" type="number" min={1} max={365} defaultValue={14} aria-label="Trial days" className="w-24" />
          <Input name="maxUses" type="number" min={1} placeholder="max uses" aria-label="Max uses" className="w-28" />
          <Input name="expiresAt" type="date" aria-label="Expires" className="w-auto" />
          <Input name="note" placeholder="note" aria-label="Note" className="w-48" />
          <Button type="submit">Create code</Button>
        </form>
        {couponRows.length > 0 ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  {["Code", "Kind", "Days", "Used", "Expires", "Note"].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {couponRows.map((c) => (
                  <tr key={c.code}>
                    <Td className="font-mono">{c.code}</Td>
                    <Td>{c.kind}</Td>
                    <Td>{c.days ?? "-"}</Td>
                    <Td>
                      {c.uses}
                      {c.maxUses ? ` of ${c.maxUses}` : ""}
                    </Td>
                    <Td>{c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : "never"}</Td>
                    <Td>{c.note ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : null}
      </Card>

      <Card className="grid gap-3">
        <SectionTitle>Beast Mode deletions</SectionTitle>
        <Meta className="text-[15px]">
          BEAST_DELETE is <strong>{env().BEAST_DELETE}</strong> (dry_run lists only, on deletes, off stops everything). Prospects by status:{" "}
          {prospects.counts.length > 0 ? prospects.counts.map((c) => `${c.status} ${c.n}`).join(", ") : "none yet"}. A deleted contact can be
          restored for 23 hours.
        </Meta>
        {prospects.rows.length > 0 ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Status</Th>
                  <Th>Due</Th>
                  <Th>Note</Th>
                  <Th>Restore</Th>
                </tr>
              </thead>
              <tbody>
                {prospects.rows.map((p) => {
                  const backup = backupOf.get(p.id);
                  return (
                    <tr key={p.id}>
                      <Td>{p.account ?? p.accountId}</Td>
                      <Td>
                        <Badge tone={p.status === "kept" || p.status === "abandoned" ? "warning" : p.status === "deleted" ? "neutral" : "primary"}>
                          {p.status === "created" && p.wouldDeleteAt ? "would delete" : p.status}
                        </Badge>
                      </Td>
                      <Td>{p.expiresAt.toISOString().slice(0, 16).replace("T", " ")}</Td>
                      <Td>{p.lastError ?? ""}</Td>
                      <Td>
                        {backup && !backup.restoredAt ? (
                          <form method="post" action="/api/admin">
                            <input type="hidden" name="kind" value="restore_prospect" />
                            <input type="hidden" name="backupId" value={backup.id} />
                            <Button type="submit" variant="outline" size="sm">
                              Restore
                            </Button>
                          </form>
                        ) : backup?.restoredAt ? (
                          "restored"
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : null}
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
                    <Badge tone={a.status === "active" ? "success" : a.status === "registered" ? "warning" : "danger"}>{a.status}</Badge>
                    {a.accessSource ? <span className="ml-1.5 text-[13px] text-muted-foreground">via {ACCESS_LABEL[a.accessSource]}</span> : null}
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
