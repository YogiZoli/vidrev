import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { comments, contacts, integrations, replies, type ContactStage, type Intent } from "@/db/schema";

export interface PersonRow {
  id: string;
  stage: ContactStage;
  // The YouTube display name only while the comment is stored (30 days), else
  // the name the person gave at opt-in; shown here, never sent (DECISIONS A-12).
  name: string | null;
  email: string | null;
  keyword: string | null;
  intent: Intent | null;
  videoId: string | null;
  lastSeenAt: Date;
}

export interface PeopleView {
  rows: PersonRow[];
  counts: Record<ContactStage, number>;
  crmConnected: boolean;
}

// Commenters stay in vidrev; a person reaches the CRM only once they opt in
// (deliverToGhl, outbound webhooks). This page shows both sides of that line.
export async function listPeople(db: Db, accountId: string, stage: ContactStage | null, limit = 200): Promise<PeopleView> {
  const base = and(eq(contacts.accountId, accountId), isNull(contacts.mergedIntoId));
  const people = await db
    .select()
    .from(contacts)
    .where(stage ? and(base, eq(contacts.stage, stage)) : base)
    .orderBy(desc(contacts.lastSeenAt))
    .limit(limit);

  const ids = people.map((p) => p.id);
  const latest = new Map<string, { keyword: string; intent: Intent; videoId: string; authorName: string | null }>();
  if (ids.length > 0) {
    const rows = await db
      .selectDistinctOn([replies.contactId], {
        contactId: replies.contactId,
        keyword: replies.keyword,
        intent: replies.intent,
        videoId: replies.youtubeVideoId,
        authorName: comments.authorName,
      })
      .from(replies)
      .leftJoin(comments, eq(comments.id, replies.commentId))
      .where(and(eq(replies.accountId, accountId), inArray(replies.contactId, ids)))
      .orderBy(replies.contactId, desc(replies.createdAt));
    for (const r of rows) {
      if (r.contactId) latest.set(r.contactId, { keyword: r.keyword, intent: r.intent, videoId: r.videoId, authorName: r.authorName });
    }
  }

  const countRows = await db
    .select({ stage: contacts.stage, n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(base)
    .groupBy(contacts.stage);
  const counts: Record<ContactStage, number> = { commenter: 0, subscriber: 0, buyer: 0 };
  for (const c of countRows) counts[c.stage] = c.n;

  const [crm] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")))
    .limit(1);

  return {
    rows: people.map((p) => {
      const l = latest.get(p.id);
      return {
        id: p.id,
        stage: p.stage,
        name: p.displayName ?? l?.authorName ?? null,
        email: p.primaryEmailNorm,
        keyword: l?.keyword ?? null,
        intent: l?.intent ?? null,
        videoId: l?.videoId ?? null,
        lastSeenAt: p.lastSeenAt,
      };
    }),
    counts,
    crmConnected: Boolean(crm),
  };
}
