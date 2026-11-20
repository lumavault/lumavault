import type { DbOrTx } from "#/db/index.js";
import { iamPairingRequests } from "#/db/schemas/iam.js";
import type { NewPairingRequest } from "./types.js";

/** Stores a pending pairing and returns its ID. Fails with a unique violation when another pending pairing has the same code. */
export async function createPairingRequest(db: DbOrTx, input: NewPairingRequest): Promise<string> {
  const [row] = await db.insert(iamPairingRequests).values(input).returning({ id: iamPairingRequests.id });
  return row!.id;
}
