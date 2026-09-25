import { plans } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";
import { PLAN_SEEDS } from "@/lib/plans";
import { createAccountWithUser, type DbOrTx, findUserByEmail, writeAudit } from "@/server/accounts";

// Inserts missing plans only; rows edited later in the database are kept.
export async function seedPlans(db: DbOrTx): Promise<void> {
  await db
    .insert(plans)
    .values(PLAN_SEEDS.map((p) => ({ ...p })))
    .onConflictDoNothing({ target: plans.code });
}

// Owner accounts (ADMIN_EMAILS) exist from the first deploy on the internal
// plan, so the owner can sign in without a checkout.
export async function seedAdminAccounts(db: DbOrTx, emails: string[]): Promise<number> {
  let created = 0;
  for (const email of emails.map(normalizeEmail)) {
    if (await findUserByEmail(db, email)) continue;
    const { account } = await createAccountWithUser(db, { email, planCode: "internal" });
    await writeAudit(db, { actor: "system", accountId: account.id, action: "admin.seeded", details: { email } });
    created += 1;
  }
  return created;
}
