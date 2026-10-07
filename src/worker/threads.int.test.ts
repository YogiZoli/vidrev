import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { replies } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { rig } from "./beast.fixture";
import { createProspect } from "./prospects";
import { handleOutbound, pushToThread, replyBodyFrom, syncThreadStatuses, threadMessage } from "./threads";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();
const PROVIDER = "PROV-1";

describe("thread texts", () => {
  it("puts the comment, the draft and the instructions in one message", () => {
    const text = threadMessage({ videoId: "dQw4w9WgXcQ", keyword: "GUIDE", commentText: "GUIDE please", draft: "Here {link}" });
    expect(text).toContain("https://youtu.be/dQw4w9WgXcQ");
    expect(text).toContain("GUIDE please");
    expect(text).toContain("Here {link}");
  });

  it("turns OK into the draft and adds the link to the creator's own text", () => {
    expect(replyBodyFrom(" ok. ", "Draft {link}")).toBe("Draft {link}");
    expect(replyBodyFrom("Send", "Draft {link}")).toBe("Draft {link}");
    expect(replyBodyFrom("Grab it here", "Draft {link}")).toBe("Grab it here {link}");
    expect(replyBodyFrom("Here: {link} enjoy", "Draft {link}")).toBe("Here: {link} enjoy");
  });
});

describe.skipIf(!hasDb)("Beast Mode thread (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function threaded() {
    const r = await rig();
    const deps = { ...r.deps, providerId: PROVIDER };
    const c = await r.comment();
    await createProspect(r.deps, c.replyId);
    const prospect = (await r.prospectOf(c.contactId))!;
    return { r, deps, c, prospect };
  }

  it("opens one thread per prospect and posts each comment once", async () => {
    const { r, deps, c, prospect } = await threaded();
    expect(await pushToThread(deps, c.replyId)).toBe("posted");
    expect(await pushToThread(deps, c.replyId)).toBe("done");
    const second = await r.comment(c.contactId);
    expect(await pushToThread(deps, second.replyId)).toBe("posted");
    expect(r.crm.conversations).toEqual([{ id: "CV-1", contactId: prospect.ghlContactId, providerId: PROVIDER }]);
    expect(r.crm.inbound).toHaveLength(2);
    expect(r.crm.inbound[0]!.message).toContain("GUIDE please");
    expect(await pushToThread({ ...deps, providerId: null }, second.replyId)).toBe("no_provider");
  });

  it("approves the draft on OK, only after reading the message back, and never twice", async () => {
    const { r, deps, c, prospect } = await threaded();
    await pushToThread(deps, c.replyId);
    r.crm.messages.set("M-1", { id: "M-1", direction: "outbound", contactId: prospect.ghlContactId!, conversationId: "CV-1", body: "OK" });
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "M-1" })).toBe("approved");
    const [reply] = await db().select().from(replies).where(eq(replies.id, c.replyId));
    expect(reply?.status).toBe("approved");
    expect(reply?.body).toBe("Here you go {link}");
    expect(reply?.crmMessageId).toBe("M-1");
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "M-1" })).toBe("duplicate");

    // Posted on YouTube: the CRM message shows delivered, once.
    await db().update(replies).set({ status: "sent" }).where(eq(replies.id, c.replyId));
    await syncThreadStatuses(r.deps);
    await syncThreadStatuses(r.deps);
    expect(r.crm.statuses.filter((s) => s.messageId === "M-1")).toEqual([{ messageId: "M-1", status: "delivered" }]);
  });

  it("uses the creator's own text and refuses forged or foreign messages", async () => {
    const { r, deps, c, prospect } = await threaded();
    await pushToThread(deps, c.replyId);
    // Not in the CRM (a forged webhook), inbound, another contact, another provider.
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "NOPE" })).toBe("not_verified");
    r.crm.messages.set("IN-1", { id: "IN-1", direction: "inbound", contactId: prospect.ghlContactId!, body: "OK" });
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "IN-1" })).toBe("not_verified");
    r.crm.messages.set("X-1", { id: "X-1", direction: "outbound", contactId: "someone-else", body: "OK" });
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "X-1" })).toBe("no_prospect");
    r.crm.messages.set("P-1", { id: "P-1", direction: "outbound", contactId: prospect.ghlContactId!, conversationProviderId: "OTHER", body: "OK" });
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "P-1" })).toBe("not_verified");
    expect(await handleOutbound(deps, { locationId: "unknown-location", messageId: "P-1" })).toBe("unknown_location");
    expect((await db().select().from(replies).where(eq(replies.id, c.replyId)))[0]?.status).toBe("pending_approval");

    r.crm.messages.set("M-2", { id: "M-2", direction: "outbound", contactId: prospect.ghlContactId!, body: "Here is your guide" });
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "M-2" })).toBe("approved");
    expect((await db().select().from(replies).where(eq(replies.id, c.replyId)))[0]?.body).toBe("Here is your guide {link}");

    // Nothing left waiting: the CRM message is marked failed with the reason.
    r.crm.messages.set("M-3", { id: "M-3", direction: "outbound", contactId: prospect.ghlContactId!, body: "OK" });
    expect(await handleOutbound(deps, { locationId: r.location, messageId: "M-3" })).toBe("no_draft");
    expect(r.crm.statuses).toContainEqual({ messageId: "M-3", status: "failed" });
  });
});
