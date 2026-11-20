import type { DbOrTx } from "#/db/index.js";
import { iamObjectClaims } from "#/db/schemas/iam.js";
import type { NewObjectClaim } from "./types.js";

/** Records who pays for an object. Fails with a unique violation when the object is already claimed. */
export async function createObjectClaim(db: DbOrTx, input: NewObjectClaim): Promise<void> {
  await db.insert(iamObjectClaims).values(input);
}
