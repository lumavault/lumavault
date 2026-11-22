import type { DbOrTx } from "#/db/index.js";
import { iamPairingRequests } from "#/db/schemas/iam.js";
import type { NewPairingRequest } from "./types.js";

/** Inserts a pending pairing request and returns its ID. Fails on a code another pending request holds. */
export async function createPairingRequest(db: DbOrTx, input: NewPairingRequest): Promise<string> {
  const [row] = await db.insert(iamPairingRequests).values(input).returning({ id: iamPairingRequests.id });
  return row!.id;
}
