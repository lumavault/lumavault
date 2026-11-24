import type { DbOrTx } from '#/db/index.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { eq } from 'drizzle-orm'

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
