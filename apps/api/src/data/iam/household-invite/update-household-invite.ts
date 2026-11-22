import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamHouseholdInvites } from "#/db/schemas/iam.js";

export async function revokeHouseholdInvite(db: DbOrTx, inviteId: string, now: Date): Promise<void> {
  await db.update(iamHouseholdInvites).set({ revokedAt: now }).where(eq(iamHouseholdInvites.id, inviteId));
}

/** Revokes every unused, unrevoked invite for this lowercased email. */
export async function revokeUnusedHouseholdInvitesByEmail(db: DbOrTx, email: string, now: Date): Promise<void> {
  await db
    .update(iamHouseholdInvites)
    .set({ revokedAt: now })
    .where(and(eq(iamHouseholdInvites.email, email), isNull(iamHouseholdInvites.redeemedAt), isNull(iamHouseholdInvites.revokedAt)));
}
