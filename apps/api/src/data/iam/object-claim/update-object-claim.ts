import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamObjectClaims } from "#/db/schemas/iam.js";

/** Marks a claim refunded, so the refund happens only once. */
export async function markObjectClaimReleased(db: DbOrTx, objectId: string): Promise<void> {
  await db.update(iamObjectClaims).set({ releasedAt: new Date() }).where(eq(iamObjectClaims.objectId, objectId));
}

/** Bills these objects to another household. */
export async function moveObjectClaims(db: DbOrTx, objectIds: string[], toHouseholdId: string): Promise<void> {
  await db.update(iamObjectClaims).set({ householdId: toHouseholdId }).where(inArray(iamObjectClaims.objectId, objectIds));
}
