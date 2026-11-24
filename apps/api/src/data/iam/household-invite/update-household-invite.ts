import type { DbOrTx } from '#/db/index.js'
import { iamHouseholdInvites } from '#/db/schemas/iam.js'
import { and, eq, isNull } from 'drizzle-orm'

export async function revokeHouseholdInvite(
  db: DbOrTx,
  inviteId: string,
  now: Date,
): Promise<void> {
  await db
    .update(iamHouseholdInvites)
    .set({ revokedAt: now })
    .where(eq(iamHouseholdInvites.id, inviteId))
}

/** Revokes every unused, unrevoked invite for this lowercased email. */
export async function revokeUnusedHouseholdInvitesByEmail(
  db: DbOrTx,
  email: string,
  now: Date,
): Promise<void> {
  await db
    .update(iamHouseholdInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(iamHouseholdInvites.email, email),
        isNull(iamHouseholdInvites.redeemedAt),
        isNull(iamHouseholdInvites.revokedAt),
      ),
    )
}

/** Marks an invite used by this user to create this household. */
export async function redeemHouseholdInvite(
  db: DbOrTx,
  inviteId: string,
  input: { userId: string; householdId: string; now: Date },
): Promise<void> {
  await db
    .update(iamHouseholdInvites)
    .set({
      redeemedAt: input.now,
      redeemedBy: input.userId,
      householdId: input.householdId,
    })
    .where(eq(iamHouseholdInvites.id, inviteId))
}
