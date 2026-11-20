import { eq, sql } from "drizzle-orm";
import { noRowsOnBadUuid } from "#/db/errors.js";
import type { DbOrTx } from "#/db/index.js";
import { iamPairingRequests } from "#/db/schemas/iam.js";
import type { PairingRequest } from "./types.js";

/** A pairing by ID. Null when it does not exist or the ID is not a UUID. */
export async function getPairingRequest(db: DbOrTx, pairingId: string): Promise<PairingRequest | null> {
  const [pairing] = await db
    .select()
    .from(iamPairingRequests)
    .where(eq(iamPairingRequests.id, sql`${pairingId}::uuid`))
    .catch(noRowsOnBadUuid);
  return pairing ?? null;
}
