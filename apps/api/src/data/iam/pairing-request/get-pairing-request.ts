import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { iamPairingRequests } from '#/db/schemas/iam.js'
import { eq } from 'drizzle-orm'

import type { PairingRequest } from './types.js'

/** A pairing request by ID. Null when it does not exist or the ID is not a UUID. */
export async function getPairingRequest(
  db: DbOrTx,
  pairingId: string,
): Promise<PairingRequest | null> {
  const [row] = await db
    .select()
    .from(iamPairingRequests)
    .where(eq(iamPairingRequests.id, uuid(pairingId)))
    .catch(noRowsOnBadUuid)
  return row ?? null
}
