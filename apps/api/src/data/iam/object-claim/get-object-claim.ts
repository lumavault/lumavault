import type { DbOrTx } from '#/db/index.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, eq, inArray, isNull, sum } from 'drizzle-orm'

import type { ObjectClaim } from './types.js'

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
