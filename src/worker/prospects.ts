import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, notExists, sql } from "drizzle-orm";
import { accounts, comments, contacts, crmProspectBackups, crmProspects, integrations, replies } from "@/db/schema";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { TAG_PROSPECT, TEMPERATURES, temperatureTag, vidrevTags } from "@/lib/tags";
import { LINK_PLACEHOLDER } from "@/lib/templates";
import { crmSyncModeState } from "@/server/crm-sync-mode";
import { type GhlApi, GhlApiError, type GhlContact } from "@/server/ghl/api";
import { type GhlConfig, GhlReauthError, updateGhlConfig, withGhlApi } from "@/server/ghl/tokens";
import type { GhlWorkerDeps } from "./ghl";

// Beast Mode prospects (DECISIONS A-25, A-27). A keyword commenter becomes a
// CRM contact at comment time (display name, tags, no email). Unless they opt
// in, the contact is deleted on the 29th day. Only contacts vidrev itself
// created are ever deleted, and only after two independent proofs.

// Owner rule (2026-10-07): nothing of a prospect may outlive 29 days, in the
// CRM or here. The hourly delete starts on day 28 and is retried for one day,
// so every contact is gone by day 29; backups never pass day 29 either.
export const MAX_AGE_MS = 29 * 86_400_000;
export const PROSPECT_TTL_MS = 28 * 86_400_000;
// The CRM delete is retried this long past PROSPECT_TTL_MS, then our side gives up.
export const DELETE_GRACE_MS = MAX_AGE_MS - PROSPECT_TTL_MS;
// Backups of deleted contacts: 23 hours at most, and never past day 29.
export const BACKUP_TTL_MS = 23 * 3_600_000;
// How far the CRM is paged to find a contact whose create was never confirmed.
const FIND_MAX_PAGES = 200;

// A create that timed out or was interrupted may still have made the contact:
// find it by the prospect tag and our row id in the "vidrev prospect id"
// field. Throws when the search cannot finish, so the sweep retries.
export async function findProspectContact(api: GhlApi, config: GhlConfig, prospectId: string): Promise<string | null> {
  if (!config.prospectFieldId) return null;
  let page: { startAfterId?: string; startAfter?: string | number } = {};
  for (let n = 0; n < FIND_MAX_PAGES; n += 1) {
    const { contacts: rows, next } = await api.listContacts(config.locationId, page);
    const hit = rows.find(
      (c) =>
        (c.tags ?? []).some((tag) => tag.trim().toLowerCase() === TAG_PROSPECT) &&
        c.customFields?.some((f) => f.id === config.prospectFieldId && f.value === prospectId),
    );
    if (hit) return hit.id;
    if (!next || rows.length === 0) return null;
    page = next;
  }
  throw new Error("contact search did not finish within the page limit");
}
// A claim still "creating" after this long belongs to a worker that stopped.
export const STALE_CREATING_MS = 15 * 60_000;
export const PROSPECT_FIELD_NAME = "vidrev prospect id";
const FALLBACK_NAME = "YouTube commenter";

async function ensureProspectField(deps: GhlWorkerDeps, integrationId: string, api: GhlApi, config: GhlConfig): Promise<string> {
  if (config.prospectFieldId) return config.prospectFieldId;
  const fields = await api.listContactFields(config.locationId);
  const existing = fields.find((f) => f.fieldKey === "contact.vidrev_prospect_id" || f.name?.trim().toLowerCase() === PROSPECT_FIELD_NAME);
  const id = (existing ?? (await api.createContactField(config.locationId, PROSPECT_FIELD_NAME))).id;
  await updateGhlConfig(deps, integrationId, { prospectFieldId: id });
  return id;
}

function prospectTags(reply: { keyword: string; intent: string; youtubeVideoId: string }): string[] {
  return [...vidrevTags({ keyword: reply.keyword, intent: reply.intent, videoId: reply.youtubeVideoId }), TAG_PROSPECT];
}

// Contacts merged away point to the winner; the live one tells the stage.
async function liveStage(deps: GhlWorkerDeps, contactId: string): Promise<string | null> {
  let id: string | null = contactId;
  for (let depth = 0; id && depth < 10; depth += 1) {
    const [row] = await deps.db.select({ stage: contacts.stage, mergedIntoId: contacts.mergedIntoId }).from(contacts).where(eq(contacts.id, id));
    if (!row) return null;
    if (!row.mergedIntoId) return row.stage;
    id = row.mergedIntoId;
  }
  return null;
}

async function activeGhl(deps: GhlWorkerDeps, accountId: string) {
  const [row] = await deps.db
    .select({ id: integrations.id, syncState: integrations.syncState })
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
  return row && row.syncState.setup === "done" ? row : null;
}

export type ProspectOutcome = "not_beast" | "no_crm" | "no_contact" | "opted_in" | "tagged" | "pending" | "created" | "unconfirmed";

// Job ghl.prospect, queued by the draft step for a Beast Mode account.
export async function createProspect(deps: GhlWorkerDeps & { beastAllowlist?: string }, replyId: string): Promise<ProspectOutcome> {
  const now = deps.now?.() ?? new Date();
  const [reply] = await deps.db.select().from(replies).where(eq(replies.id, replyId));
  if (!reply?.contactId) return "no_contact";
  // Checked again here: the mode or the allowlist may have changed since the comment.
  if ((await crmSyncModeState(deps.db, reply.accountId, deps.beastAllowlist)).effective !== "beast") return "not_beast";
  const ghl = await activeGhl(deps, reply.accountId);
  if (!ghl) return "no_crm";
  // Already a lead: the opt-in path (A-15) owns them.
  if ((await liveStage(deps, reply.contactId)) !== "commenter") return "opted_in";
  const tags = prospectTags(reply);

  // Our row is claimed before the CRM is called: two jobs for the same person
  // can never both create a contact (unique live row per account and Contact).
  const [claimed] = await deps.db
    .insert(crmProspects)
    .values({ accountId: reply.accountId, contactId: reply.contactId, integrationId: ghl.id, expiresAt: new Date(now.getTime() + PROSPECT_TTL_MS) })
    .onConflictDoNothing()
    .returning();
  if (!claimed) {
    const [live] = await deps.db
      .select()
      .from(crmProspects)
      .where(
        and(
          eq(crmProspects.accountId, reply.accountId),
          eq(crmProspects.contactId, reply.contactId),
          eq(crmProspects.integrationId, ghl.id),
          inArray(crmProspects.status, ["creating", "created", "unconfirmed"]),
        ),
      );
    if (live?.status === "creating") {
      // A worker that stopped mid-create (deploy, crash) leaves the claim in
      // "creating" for ever: every later comment of this person would wait on
      // it without a trace. After 15 minutes it is closed as unconfirmed (the
      // contact may exist, so it is never created twice); until then this
      // job comes back in a minute so its thread is not lost.
      if (now.getTime() - live.createdAt.getTime() >= STALE_CREATING_MS) {
        await deps.db
          .update(crmProspects)
          .set({ status: "unconfirmed", lastError: "create interrupted (worker stopped)", updatedAt: now })
          .where(and(eq(crmProspects.id, live.id), eq(crmProspects.status, "creating")));
        log("warn", "prospect create was interrupted, closed as unconfirmed", { accountId: reply.accountId, prospectId: live.id });
        return "unconfirmed";
      }
      await deps.enqueue("ghl.prospect", { replyId }, { startAfter: 60 });
      return "pending";
    }
    if (live?.status !== "created" || !live.ghlContactId) return "pending";
    // Same person, another keyword or video: more tags on the same contact.
    try {
      await withGhlApi(deps, ghl.id, async (api) => {
        await api.addTags(live.ghlContactId!, tags);
        const cooler = TEMPERATURES.map(temperatureTag).filter((tag) => !tags.includes(tag));
        if (cooler.length < TEMPERATURES.length) await api.removeTags(live.ghlContactId!, cooler);
      });
    } catch (error) {
      if (error instanceof GhlReauthError) return "no_crm";
      throw error;
    }
    return "tagged";
  }

  const [comment] = reply.commentId ? await deps.db.select({ authorName: comments.authorName }).from(comments).where(eq(comments.id, reply.commentId)) : [];
  const name = comment?.authorName?.trim().slice(0, 200) || FALLBACK_NAME;
  let sent = false;
  try {
    await withGhlApi(deps, ghl.id, async (api, config) => {
      const fieldId = await ensureProspectField(deps, ghl.id, api, config);
      sent = true;
      const ghlContactId = await api.createContact(config.locationId, { name, tags, customFields: [{ id: fieldId, value: claimed.id }] });
      await deps.db
        .update(crmProspects)
        .set({ status: "created", ghlContactId, ghlLocationId: config.locationId, updatedAt: now })
        .where(eq(crmProspects.id, claimed.id));
    });
  } catch (error) {
    // A clear refusal (4xx) or a failure before the create call: nothing was
    // made, so the claim is released and the job may retry. Anything else may
    // have created the contact: never create a second one.
    const nothingMade = !sent || error instanceof GhlReauthError || (error instanceof GhlApiError && error.status >= 400 && error.status < 500 && error.status !== 408);
    if (error instanceof GhlApiError) log("warn", "prospect create refused by the crm", { accountId: reply.accountId, status: error.status, body: error.body.slice(0, 300) });
    if (nothingMade) {
      await deps.db.delete(crmProspects).where(and(eq(crmProspects.id, claimed.id), eq(crmProspects.status, "creating")));
      if (error instanceof GhlReauthError) return "no_crm";
      throw error;
    }
    await deps.db
      .update(crmProspects)
      .set({ status: "unconfirmed", lastError: String(error instanceof Error ? error.message : error).slice(0, 300), updatedAt: now })
      .where(eq(crmProspects.id, claimed.id));
    log("warn", "prospect create unconfirmed, not retried", { accountId: reply.accountId, prospectId: claimed.id, ...errorFields(error) });
    return "unconfirmed";
  }
  log("info", "prospect contact created", { accountId: reply.accountId, prospectId: claimed.id });
  return "created";
}

// The draft step queues ghl.prospect; if that queueing failed, or the job
// failed on every retry (the claim is released then), the commenter never
// reached the CRM. Hourly, a Beast Mode reply from the last 2 days whose
// person has no prospect row at all is queued again. createProspect checks
// the mode, the allowlist and the claim itself, so a repeat is harmless.
export const LOST_PROSPECT_AFTER_MS = 15 * 60_000;
export const LOST_PROSPECT_WINDOW_MS = 2 * 86_400_000;

export async function requeueLostProspects(deps: Pick<GhlWorkerDeps, "db" | "enqueue" | "now">): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const rows = await deps.db
    .select({ id: replies.id })
    .from(replies)
    .innerJoin(accounts, eq(accounts.id, replies.accountId))
    // Only people still at the commenter stage: a lead belongs to the opt-in path.
    .innerJoin(contacts, eq(contacts.id, replies.contactId))
    .where(
      and(
        eq(accounts.crmSyncMode, "beast"),
        eq(contacts.stage, "commenter"),
        isNull(contacts.mergedIntoId),
        isNotNull(replies.contactId),
        lt(replies.createdAt, new Date(now.getTime() - LOST_PROSPECT_AFTER_MS)),
        gt(replies.createdAt, new Date(now.getTime() - LOST_PROSPECT_WINDOW_MS)),
        notExists(
          deps.db
            .select({ one: sql`1` })
            .from(crmProspects)
            .where(and(eq(crmProspects.accountId, replies.accountId), eq(crmProspects.contactId, replies.contactId))),
        ),
      ),
    )
    .limit(500);
  for (const { id } of rows) await deps.enqueue("ghl.prospect", { replyId: id }, { singletonKey: `prospect:${id}` });
  if (rows.length > 0) log("warn", "beast mode replies without a prospect, queued again", { count: rows.length });
  return rows.length;
}

export type OwnershipCheck = { ok: true; contact: GhlContact } | { ok: false; reason: string } | { ok: "gone" };

// The second, independent proof (A-27), read live right before a delete:
// our prospect row id in the "vidrev prospect id" field, the prospect tag,
// and no email or phone. A contact with an email or a phone is never ours to
// delete, whatever else it shows.
export function proveOwnProspect(contact: GhlContact | null, prospect: { id: string }, fieldId: string | null | undefined): OwnershipCheck {
  if (!contact) return { ok: "gone" };
  if (contact.email?.trim()) return { ok: false, reason: "has an email" };
  if (contact.phone?.trim()) return { ok: false, reason: "has a phone" };
  if (!fieldId) return { ok: false, reason: "prospect field unknown" };
  const value = contact.customFields?.find((f) => f.id === fieldId)?.value;
  if (value !== prospect.id) return { ok: false, reason: "prospect id field does not match" };
  if (!(contact.tags ?? []).some((tag) => tag.trim().toLowerCase() === TAG_PROSPECT)) return { ok: false, reason: "prospect tag missing" };
  return { ok: true, contact };
}

// The only caller of api.deleteContact. Proves ownership itself, so no other
// code path can delete a contact without both proofs.
export async function deleteOwnProspect(
  deps: GhlWorkerDeps,
  api: GhlApi,
  config: GhlConfig,
  prospect: typeof crmProspects.$inferSelect,
  now: Date,
): Promise<{ deleted: true } | { deleted: false; gone: true } | { deleted: false; kept: string }> {
  if (!prospect.ghlContactId || prospect.ghlLocationId !== config.locationId) return { deleted: false, kept: "not our contact id in this location" };
  const check = proveOwnProspect(await api.getContact(prospect.ghlContactId), prospect, config.prospectFieldId);
  if (check.ok === "gone") return { deleted: false, gone: true };
  if (!check.ok) return { deleted: false, kept: check.reason };
  await deps.db.insert(crmProspectBackups).values({
    prospectId: prospect.id,
    accountId: prospect.accountId,
    contact: check.contact as unknown as Record<string, unknown>,
    expiresAt: new Date(Math.min(now.getTime() + BACKUP_TTL_MS, prospect.createdAt.getTime() + MAX_AGE_MS)),
  });
  await api.deleteContact(prospect.ghlContactId);
  return { deleted: true };
}

export interface SweepResult {
  mode: "off" | "dry_run" | "on";
  deleted: number;
  wouldDelete: number;
  kept: number;
  optedIn: number;
  retry: number;
  abandoned: number;
  backupsDropped: number;
}

// Hourly. Prospects past their 29 days: opted in ones are left alone, the
// rest are deleted from the CRM (BEAST_DELETE=on), listed only (dry_run) or
// not touched at all (off, the emergency brake).
export async function sweepProspects(deps: GhlWorkerDeps, mode = env().BEAST_DELETE): Promise<SweepResult> {
  const now = deps.now?.() ?? new Date();
  const result: SweepResult = { mode, deleted: 0, wouldDelete: 0, kept: 0, optedIn: 0, retry: 0, abandoned: 0, backupsDropped: 0 };
  // Backups never outlive their 23 hours, whatever the mode.
  result.backupsDropped = (await deps.db.delete(crmProspectBackups).where(lte(crmProspectBackups.expiresAt, now)).returning({ id: crmProspectBackups.id })).length;
  if (mode === "off") {
    log("info", "prospect sweep off (BEAST_DELETE=off)");
    return result;
  }
  const set = (id: string, values: Partial<Omit<typeof crmProspects.$inferInsert, "deleteAttempts">> & { deleteAttempts?: ReturnType<typeof sql> }) =>
    deps.db.update(crmProspects).set({ ...values, updatedAt: now }).where(eq(crmProspects.id, id));

  const due = await deps.db
    .select()
    .from(crmProspects)
    .where(and(inArray(crmProspects.status, ["created", "creating", "unconfirmed"]), lte(crmProspects.expiresAt, now)));
  for (let prospect of due) {
    if ((await liveStage(deps, prospect.contactId)) !== "commenter") {
      // Opted in: never deleted by the 29 day rule. The merge deletes it (its
      // tags and summary went to the email contact at opt-in).
      if (prospect.status === "created" && prospect.integrationId && mode === "on") {
        await mergeProspects(deps, { integrationId: prospect.integrationId, contactId: prospect.contactId, emailContactId: null }, mode).catch((error: unknown) =>
          log("warn", "opted-in prospect merge failed, retried next hour", { prospectId: prospect.id, ...errorFields(error) }),
        );
      } else if (prospect.status === "created") {
        // Dry run or brake: listed, deleted once BEAST_DELETE is on.
        await set(prospect.id, { wouldDeleteAt: now });
      } else {
        await set(prospect.id, { status: "opted_in" });
      }
      result.optedIn += 1;
      continue;
    }
    const pastGrace = now.getTime() >= prospect.expiresAt.getTime() + DELETE_GRACE_MS;
    // Never confirmed by the CRM: the contact may still exist, so it is looked
    // up by our row id and then goes through the same proofs and delete.
    if (prospect.status !== "created" || !prospect.ghlContactId) {
      if (mode === "dry_run") {
        await set(prospect.id, { wouldDeleteAt: now });
        result.wouldDelete += 1;
        continue;
      }
      let found: { id: string; locationId: string } | null = null;
      try {
        const [ghl] = prospect.integrationId ? await deps.db.select({ status: integrations.status }).from(integrations).where(eq(integrations.id, prospect.integrationId)) : [];
        if (ghl?.status !== "active") throw new Error("CRM connection is not active");
        found = await withGhlApi(deps, prospect.integrationId!, async (api, config) => {
          const id = await findProspectContact(api, config, prospect.id);
          return id ? { id, locationId: config.locationId } : null;
        });
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 300);
        const giveUp = now.getTime() >= prospect.expiresAt.getTime() + DELETE_GRACE_MS;
        await set(prospect.id, { ...(giveUp ? { status: "abandoned" as const } : {}), lastError: message, deleteAttempts: sql`${crmProspects.deleteAttempts} + 1` });
        log(giveUp ? "error" : "warn", giveUp ? "unconfirmed prospect search gave up" : "unconfirmed prospect search failed, retried next hour", { accountId: prospect.accountId, prospectId: prospect.id, ...errorFields(error) });
        if (giveUp) result.abandoned += 1;
        else result.retry += 1;
        continue;
      }
      if (!found) {
        await set(prospect.id, { status: "abandoned", lastError: "no contact with this prospect id in the CRM" });
        log("info", "unconfirmed prospect not in the crm, closed", { accountId: prospect.accountId, prospectId: prospect.id });
        result.abandoned += 1;
        continue;
      }
      await set(prospect.id, { status: "created", ghlContactId: found.id, ghlLocationId: found.locationId });
      log("warn", "unconfirmed prospect found in the crm, deleting it", { accountId: prospect.accountId, prospectId: prospect.id });
      prospect = { ...prospect, status: "created", ghlContactId: found.id, ghlLocationId: found.locationId };
    }
    if (mode === "dry_run") {
      await set(prospect.id, { wouldDeleteAt: now });
      log("info", "prospect would be deleted (dry run)", { accountId: prospect.accountId, prospectId: prospect.id });
      result.wouldDelete += 1;
      continue;
    }
    const [ghl] = prospect.integrationId
      ? await deps.db.select({ status: integrations.status }).from(integrations).where(eq(integrations.id, prospect.integrationId))
      : [];
    try {
      if (ghl?.status !== "active") throw new Error("CRM connection is not active");
      const outcome = await withGhlApi(deps, prospect.integrationId!, (api, config) => deleteOwnProspect(deps, api, config, prospect, now));
      if (outcome.deleted || "gone" in outcome) {
        await set(prospect.id, { status: "deleted", deletedAt: now, lastError: outcome.deleted ? null : "already gone in the CRM" });
        result.deleted += 1;
      } else {
        await set(prospect.id, { status: "kept", lastError: outcome.kept });
        log("warn", "prospect kept: ownership proof failed", { accountId: prospect.accountId, prospectId: prospect.id, reason: outcome.kept });
        result.kept += 1;
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 300);
      if (pastGrace) {
        await set(prospect.id, { status: "abandoned", lastError: message, deleteAttempts: sql`${crmProspects.deleteAttempts} + 1` });
        log("error", "prospect delete gave up after the grace days", { accountId: prospect.accountId, prospectId: prospect.id, ...errorFields(error) });
        result.abandoned += 1;
      } else {
        await set(prospect.id, { lastError: message, deleteAttempts: sql`${crmProspects.deleteAttempts} + 1` });
        log("warn", "prospect delete failed, retried next hour", { accountId: prospect.accountId, prospectId: prospect.id, ...errorFields(error) });
        result.retry += 1;
      }
    }
  }
  log("info", "prospect sweep done", { ...result });
  return result;
}

// Owner restore from /admin (A-27): the contact is made again from the
// backup, without the prospect tag and field, so it is never ours to delete.
export async function restoreProspect(deps: GhlWorkerDeps, backupId: string): Promise<"restored" | "missing" | "no_crm"> {
  const now = deps.now?.() ?? new Date();
  const [backup] = await deps.db.select().from(crmProspectBackups).where(eq(crmProspectBackups.id, backupId));
  if (!backup || backup.restoredAt) return "missing";
  const [prospect] = await deps.db.select().from(crmProspects).where(eq(crmProspects.id, backup.prospectId));
  if (!prospect?.integrationId) return "no_crm";
  const contact = backup.contact as unknown as GhlContact;
  try {
    const id = await withGhlApi(deps, prospect.integrationId, (api, config) =>
      api.createContact(config.locationId, {
        name: contact.contactName ?? contact.name ?? ([contact.firstName, contact.lastName].filter(Boolean).join(" ") || FALLBACK_NAME),
        tags: (contact.tags ?? []).filter((tag) => tag.trim().toLowerCase() !== TAG_PROSPECT),
        customFields: (contact.customFields ?? [])
          .filter((f) => f.id !== config.prospectFieldId && typeof f.value === "string")
          .map((f) => ({ id: f.id, value: f.value as string })),
      }),
    );
    await deps.db.update(crmProspectBackups).set({ restoredAt: now, restoredGhlContactId: id }).where(eq(crmProspectBackups.id, backupId));
    log("info", "prospect restored by the owner", { accountId: backup.accountId, prospectId: prospect.id });
    return "restored";
  } catch (error) {
    if (error instanceof GhlReauthError) return "no_crm";
    throw error;
  }
}

// The person's prospects in this CRM connection: rows of their Contact and of
// Contacts merged into it (an opt-in may resolve to the older Contact).
async function prospectsOfPerson(deps: GhlWorkerDeps, integrationId: string, contactId: string) {
  const merged = await deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.mergedIntoId, contactId));
  const ids = [contactId, ...merged.map((r) => r.id)];
  return deps.db
    .select()
    .from(crmProspects)
    .where(and(eq(crmProspects.integrationId, integrationId), inArray(crmProspects.contactId, ids), eq(crmProspects.status, "created")));
}

// The new thread on the email contact: first-party only (A-27), our own sent
// replies with video, keyword and date, never the comment text.
async function mergeSummary(deps: GhlWorkerDeps, contactId: string): Promise<string> {
  const sent = await deps.db
    .select({ videoId: replies.youtubeVideoId, keyword: replies.keyword, body: replies.body, sentAt: replies.sentAt })
    .from(replies)
    .where(and(eq(replies.contactId, contactId), inArray(replies.status, ["sent", "sent_manually"])))
    .orderBy(replies.sentAt);
  const lines = sent.map((r) => `${r.sentAt?.toISOString().slice(0, 10) ?? ""} https://youtu.be/${r.videoId} (keyword ${r.keyword}): ${r.body.replace(LINK_PLACEHOLDER, "[link]")}`);
  return ["Opted in from YouTube comments (vidrev).", ...(lines.length > 0 ? ["", "Our replies:", ...lines] : [])].join("\n");
}

export interface MergeOutcome {
  merged: number;
  deleted: number;
  kept: number;
  waiting: number;
}

// Opt-in (A-25, A-27): the prospect's tags and a thread summary go to the
// email contact first, then the prospect is deleted through deleteOwnProspect
// (both proofs). The prospect never gets the email written to it, so the two
// contacts can never collide. Each step is recorded on the row, so a retry or
// the hourly sweep finishes a half-done merge. Deletes follow BEAST_DELETE (A-28).
export async function mergeProspects(
  deps: GhlWorkerDeps & { providerId?: string | null },
  input: { integrationId: string; contactId: string; emailContactId: string | null },
  mode = env().BEAST_DELETE,
): Promise<MergeOutcome> {
  const now = deps.now?.() ?? new Date();
  const result: MergeOutcome = { merged: 0, deleted: 0, kept: 0, waiting: 0 };
  const provider = deps.providerId === undefined ? (env().GHL_CONVERSATION_PROVIDER_ID ?? null) : deps.providerId;
  const rows = await prospectsOfPerson(deps, input.integrationId, input.contactId);
  if (rows.length === 0) return result;
  try {
    await withGhlApi(deps, input.integrationId, async (api, config) => {
      for (const prospect of rows) {
        if (!prospect.mergeCopiedAt && input.emailContactId && prospect.ghlContactId) {
          const contact = await api.getContact(prospect.ghlContactId);
          const tags = (contact?.tags ?? []).filter((tag) => tag.trim().toLowerCase() !== TAG_PROSPECT);
          if (tags.length > 0) await api.addTags(input.emailContactId, tags);
          if (provider) {
            const conversationId = await api.createConversation(config.locationId, input.emailContactId, provider);
            await api.addInboundMessage(conversationId, provider, await mergeSummary(deps, prospect.contactId));
          }
          await deps.db
            .update(crmProspects)
            .set({ mergedIntoGhlContactId: input.emailContactId, mergeCopiedAt: now, updatedAt: now })
            .where(eq(crmProspects.id, prospect.id));
          result.merged += 1;
        }
        if (mode !== "on") {
          await deps.db.update(crmProspects).set({ wouldDeleteAt: now, updatedAt: now }).where(eq(crmProspects.id, prospect.id));
          log("info", "opted-in prospect would be deleted (BEAST_DELETE not on)", { accountId: prospect.accountId, prospectId: prospect.id });
          result.waiting += 1;
          continue;
        }
        const outcome = await deleteOwnProspect(deps, api, config, prospect, now);
        if (outcome.deleted || "gone" in outcome) {
          await deps.db.update(crmProspects).set({ status: "opted_in", deletedAt: now, updatedAt: now }).where(eq(crmProspects.id, prospect.id));
          result.deleted += 1;
        } else {
          await deps.db.update(crmProspects).set({ status: "kept", lastError: outcome.kept, updatedAt: now }).where(eq(crmProspects.id, prospect.id));
          log("warn", "opted-in prospect kept: ownership proof failed", { accountId: prospect.accountId, prospectId: prospect.id, reason: outcome.kept });
          result.kept += 1;
        }
      }
    });
  } catch (error) {
    if (error instanceof GhlReauthError) return result;
    throw error;
  }
  log("info", "prospect merge", { integrationId: input.integrationId, ...result });
  return result;
}

// Before a CRM is disconnected (Settings button): our prospects in it are
// deleted now, with both proofs, because after the disconnect we can no
// longer reach them. Only BEAST_DELETE=off (the brake) stops it.
export async function cleanupProspects(deps: GhlWorkerDeps, integrationId: string, mode = env().BEAST_DELETE): Promise<{ deleted: number; kept: number }> {
  const now = deps.now?.() ?? new Date();
  const result = { deleted: 0, kept: 0 };
  if (mode === "off") return result;
  const rows = await deps.db
    .select()
    .from(crmProspects)
    .where(and(eq(crmProspects.integrationId, integrationId), inArray(crmProspects.status, ["created", "unconfirmed", "creating"])));
  if (rows.length === 0) return result;
  await withGhlApi(deps, integrationId, async (api, config) => {
    for (let prospect of rows) {
      // A never confirmed create may have made the contact: find it first.
      if (!prospect.ghlContactId) {
        const id = await findProspectContact(api, config, prospect.id);
        if (!id) {
          await deps.db.update(crmProspects).set({ status: "abandoned", lastError: "no contact with this prospect id in the CRM", updatedAt: now }).where(eq(crmProspects.id, prospect.id));
          continue;
        }
        prospect = { ...prospect, ghlContactId: id, ghlLocationId: config.locationId };
      }
      const outcome = await deleteOwnProspect(deps, api, config, prospect, now);
      if (outcome.deleted || "gone" in outcome) {
        await deps.db
          .update(crmProspects)
          .set({ status: "deleted", deletedAt: now, lastError: "deleted before disconnect", updatedAt: now })
          .where(eq(crmProspects.id, prospect.id));
        result.deleted += 1;
      } else {
        await deps.db.update(crmProspects).set({ status: "kept", lastError: outcome.kept, updatedAt: now }).where(eq(crmProspects.id, prospect.id));
        result.kept += 1;
      }
    }
  });
  log("info", "prospects cleaned up before disconnect", { integrationId, ...result });
  return result;
}
