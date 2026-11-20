import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamHouseholdInvites } from "#/db/schemas/iam.js";
import type { HouseholdInvite } from "./types.js";

/** An invite to create a household that this email can still redeem: not used, not revoked, not expired. */
export async function getOpenHouseholdInviteByEmail(
  db: DbOrTx,
  email: string,
  now: Date,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: iamHouseholdInvites.id })
    .from(iamHouseholdInvites)
    .where(
      and(
        eq(iamHouseholdInvites.email, email),
        isNull(iamHouseholdInvites.redeemedAt),
        isNull(iamHouseholdInvites.revokedAt),
        gt(iamHouseholdInvites.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Every invite that is not used, not revoked and not expired, oldest first. */
export async function listOpenHouseholdInvites(db: DbOrTx, now: Date): Promise<HouseholdInvite[]> {
  return db
    .select()
    .from(iamHouseholdInvites)
    .where(and(isNull(iamHouseholdInvites.redeemedAt), isNull(iamHouseholdInvites.revokedAt), gt(iamHouseholdInvites.expiresAt, now)))
    .orderBy(asc(iamHouseholdInvites.createdAt));
}

/** The invite whose link secret hashes to this value, in any state. */
export async function getHouseholdInviteByTokenHash(db: DbOrTx, tokenHash: string): Promise<HouseholdInvite | null> {
  const [row] = await db.select().from(iamHouseholdInvites).where(eq(iamHouseholdInvites.tokenHash, tokenHash));
  return row ?? null;
}
