import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Meta, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatUtcMinute } from "@/lib/time";
import type { SystemHealth } from "@/server/system-health";

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
      <span className="text-[15px]">{label}</span>
      <strong className={bad ? "text-danger-text" : "text-foreground"}>{value}</strong>
    </div>
  );
}

// Owner admin: does the app work right now, and if not, what exactly failed
// (the details are in the logs under the same queue or step name).
export function SystemHealthCard({ health }: { health: SystemHealth }) {
  const { worker, jobs } = health;
  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>System health</SectionTitle>
        <Badge tone={health.ok ? "success" : "danger"}>{health.ok ? "all good" : "needs a look"}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Row
          label="Worker (polling, drafts, sending)"
          value={worker.state === "ok" ? `alive, ${worker.ageSeconds ?? 0}s ago` : worker.state === "missing" ? "never started" : `silent for ${Math.round((worker.ageSeconds ?? 0) / 60)} min`}
          bad={worker.state !== "ok"}
        />
        <Row label="Jobs retrying now" value={jobs ? String(jobs.retrying) : "unknown"} bad={!jobs} />
        <Row label="Replies being sent" value={`${health.replies.sending}${health.replies.stuck ? `, ${health.replies.stuck} stuck over 30 min` : ""}`} bad={health.replies.stuck > 0} />
        <Row label="Channels connecting" value={`${health.channels.connecting}${health.channels.timedOut ? `, ${health.channels.timedOut} timed out (24 h)` : ""}`} bad={health.channels.timedOut > 0} />
        <Row label="Channels revoked by Google (24 h)" value={String(health.channels.revoked)} />
        <Row label="Integrations in error" value={String(health.integrations.length)} bad={health.integrations.length > 0} />
      </div>

      <div className="grid gap-2">
        <strong className="text-[15px]">Jobs that failed for good (24 h)</strong>
        {health.jobsError ? <Meta className="text-danger-text">Job tables could not be read: {health.jobsError}</Meta> : null}
        {jobs && jobs.failed.length === 0 ? <Meta className="text-[15px]">None.</Meta> : null}
        {jobs && jobs.failed.length > 0 ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Queue</Th>
                  <Th>Failed</Th>
                  <Th>Last</Th>
                  <Th>Last error</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.failed.map((row) => (
                  <tr key={row.queue}>
                    <Td className="font-mono text-[13px]">{row.queue}</Td>
                    <Td>{row.failed}</Td>
                    <Td className="whitespace-nowrap font-mono text-[13px]">{formatUtcMinute(row.lastAt, "")}</Td>
                    <Td className="[overflow-wrap:anywhere] text-[13px]">{row.lastError ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : null}
      </div>

      {health.replies.failedByReason.length > 0 ? (
        <div className="grid gap-2">
          <strong className="text-[15px]">Replies that failed (24 h)</strong>
          <div className="flex flex-wrap gap-2">
            {health.replies.failedByReason.map((row) => (
              <Badge key={row.reason} tone="neutral">
                {row.reason}: {row.count}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {health.integrations.length > 0 ? (
        <div className="grid gap-2">
          <strong className="text-[15px]">Integrations in error</strong>
          <TableWrap>
            <Table>
              <tbody>
                {health.integrations.map((row) => (
                  <tr key={`${row.accountId}-${row.type}`}>
                    <Td>{row.accountName ?? row.accountId}</Td>
                    <Td className="font-mono text-[13px]">{row.type}</Td>
                    <Td className="[overflow-wrap:anywhere] text-[13px]">{row.error ?? row.reason ?? ""}</Td>
                    <Td className="whitespace-nowrap font-mono text-[13px]">{formatUtcMinute(row.since, "")}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      ) : null}
      <Meta>Details of every failure are in the Railway logs under the same queue or step name. The worker emails you when a job fails for good.</Meta>
    </Card>
  );
}
