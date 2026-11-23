import { and, desc, eq, gt, isNull, type SQL } from "drizzle-orm";
import { uuid } from "#/data/sql.js";
import { noRowsOnBadUuid } from "#/db/errors.js";
import type { DbOrTx } from "#/db/index.js";
import { iamHouseholdInvites } from "#/db/schemas/iam.js";
import type { HouseholdInvite } from "./types.js";

/** Invites that can still be redeemed: not used, not revoked, not expired. */
function isOpen(now: Date): SQL {
  return and(isNull(iamHouseholdInvites.redeemedAt), isNull(iamHouseholdInvites.revokedAt), gt(iamHouseholdInvites.expiresAt, now))!;
}

/** An invite to create a household that this email can still redeem. */
export async function getOpenHouseholdInviteByEmail(
  db: DbOrTx,
  email: string,
  now: Date,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: iamHouseholdInvites.id })
    .from(iamHouseholdInvites)
    .where(and(eq(iamHouseholdInvites.email, email), isOpen(now)))
    .limit(1);
  return row ?? null;
}

/** Every invite that can still be redeemed, newest first. */
export async function getOpenHouseholdInvites(db: DbOrTx, now: Date): Promise<HouseholdInvite[]> {
  return db
    .select()
    .from(iamHouseholdInvites)
    .where(isOpen(now))
    .orderBy(desc(iamHouseholdInvites.createdAt), desc(iamHouseholdInvites.id));
}

/** An invite by ID, locked until the transaction ends. Null when it does not exist or the ID is not a UUID. */
export async function getHouseholdInviteForUpdate(db: DbOrTx, inviteId: string): Promise<HouseholdInvite | null> {
  const [row] = await db
    .select()
    .from(iamHouseholdInvites)
    .where(eq(iamHouseholdInvites.id, uuid(inviteId)))
    .for("update")
    .catch(noRowsOnBadUuid);
  return row ?? null;
}

/** An invite by the hash of its link secret. Null when no invite has that hash. */
export async function getHouseholdInviteByTokenHash(db: DbOrTx, tokenHash: string): Promise<HouseholdInvite | null> {
  const [row] = await db.select().from(iamHouseholdInvites).where(eq(iamHouseholdInvites.tokenHash, tokenHash));
  return row ?? null;
}

/** An invite by the hash of its link secret, locked until the transaction ends. */
export async function getHouseholdInviteByTokenHashForUpdate(db: DbOrTx, tokenHash: string): Promise<HouseholdInvite | null> {
  const [row] = await db.select().from(iamHouseholdInvites).where(eq(iamHouseholdInvites.tokenHash, tokenHash)).for("update");
  return row ?? null;
}
