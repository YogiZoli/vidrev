import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { runMigrations } from "@/scripts/migrate";

const hasDb = Boolean(process.env.DATABASE_URL);

// A refused checkout webhook must never be silent: logged and emailed.
describe.skipIf(!hasDb)("provisioning webhook refusals (integration)", () => {
  beforeAll(async () => {
    process.env.PROVISIONING_SECRET = "test-secret";
    process.env.ADMIN_EMAILS = "owner@example.com";
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("logs and alerts the owner when the call is not authorized", async () => {
    const { POST } = await import("./route");
    const errors: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(JSON.parse(line)));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/provisioning/ghl", { method: "POST", body: "{}" }));
    vi.restoreAllMocks();
    expect(response.status).toBe(401);
    expect(errors).toContainEqual(expect.objectContaining({ msg: "provisioning refused", reason: "unauthorized", status: 401 }));
    expect(errors).toContainEqual(expect.objectContaining({ msg: "owner alert", subject: "Provisioning webhook refused: unauthorized" }));
  });
});
