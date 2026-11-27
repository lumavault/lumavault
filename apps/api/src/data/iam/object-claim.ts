import type { DbOrTx } from '#/db/index.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, eq, isNull } from 'drizzle-orm'

/** An object claim row: which household pays for a Gateway object. */
export type ObjectClaim = typeof iamObjectClaims.$inferSelect

/** What it takes to bill a new object. */
export type NewObjectClaim = Pick<
  typeof iamObjectClaims.$inferInsert,
  'objectId' | 'householdId' | 'uploadedBy' | 'reservationId' | 'app' | 'bytes'
>

/** Records who pays for an object. Fails with a unique violation when the object is already claimed. */
export async function createObjectClaim(
  db: DbOrTx,
  input: NewObjectClaim,
): Promise<void> {
  await db.insert(iamObjectClaims).values(input)
}

/** The claim on an object, released or not. */
export async function getObjectClaim(
  db: DbOrTx,
  objectId: string,
): Promise<ObjectClaim | null> {
  const [claim] = await db
    .select()
    .from(iamObjectClaims)
    .where(eq(iamObjectClaims.objectId, objectId))
  return claim ?? null
}

/** The claim on an object that has not been released. */
export async function getActiveObjectClaim(
  db: DbOrTx,
  objectId: string,
): Promise<ObjectClaim | null> {
  const [claim] = await db
    .select()
    .from(iamObjectClaims)
    .where(
      and(
        eq(iamObjectClaims.objectId, objectId),
        isNull(iamObjectClaims.releasedAt),
      ),
    )
  return claim ?? null
}

/** The unreleased claim on an object, locked until the transaction ends. */
export async function getActiveObjectClaimForUpdate(
  db: DbOrTx,
  objectId: string,
): Promise<ObjectClaim | null> {
  const [claim] = await db
    .select()
    .from(iamObjectClaims)
    .where(
      and(
        eq(iamObjectClaims.objectId, objectId),
        isNull(iamObjectClaims.releasedAt),
      ),
    )
    .for('update')
  return claim ?? null
}

/** Marks a claim refunded, so the refund happens only once. */
export async function markObjectClaimReleased(
  db: DbOrTx,
  objectId: string,
): Promise<void> {
  await db
    .update(iamObjectClaims)
    .set({ releasedAt: new Date() })
    .where(eq(iamObjectClaims.objectId, objectId))
}
