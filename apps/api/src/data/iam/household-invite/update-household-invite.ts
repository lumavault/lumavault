import { and, eq, isNull, sql } from "drizzle-orm";
import { noRowsOnBadUuid } from "#/db/errors.js";
import type { DbOrTx } from "#/db/index.js";
import { iamHouseholdInvites } from "#/db/schemas/iam.js";

/** Revokes an invite that nobody has redeemed. False when there is no such open invite or the ID is not a UUID. */
export async function revokeOpenHouseholdInvite(db: DbOrTx, inviteId: string): Promise<boolean> {
  const updated = await db
    .update(iamHouseholdInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(iamHouseholdInvites.id, sql`${inviteId}::uuid`), isNull(iamHouseholdInvites.redeemedAt)))
    .returning({ id: iamHouseholdInvites.id })
    .catch(noRowsOnBadUuid);
  return updated.length > 0;
}

/** Marks an invite used by this person, for the household they created. */
export async function markHouseholdInviteRedeemed(
  db: DbOrTx,
  inviteId: string,
  input: { userId: string; householdId: string },
): Promise<void> {
  await db
    .update(iamHouseholdInvites)
    .set({ redeemedAt: new Date(), redeemedBy: input.userId, householdId: input.householdId })
    .where(eq(iamHouseholdInvites.id, inviteId));
}
