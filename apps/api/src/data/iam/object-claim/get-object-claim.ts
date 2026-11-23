import { and, eq, inArray, isNull, sum } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamObjectClaims } from "#/db/schemas/iam.js";
import type { ObjectClaim } from "./types.js";

/** The claim on an object, released or not. */
export async function getObjectClaim(db: DbOrTx, objectId: string): Promise<ObjectClaim | null> {
  const [claim] = await db.select().from(iamObjectClaims).where(eq(iamObjectClaims.objectId, objectId));
  return claim ?? null;
}

/** The claim on an object that has not been released. */
export async function getActiveObjectClaim(db: DbOrTx, objectId: string): Promise<ObjectClaim | null> {
  const [claim] = await db
    .select()
    .from(iamObjectClaims)
    .where(and(eq(iamObjectClaims.objectId, objectId), isNull(iamObjectClaims.releasedAt)));
  return claim ?? null;
}

/** The unreleased claim on an object, locked until the transaction ends. */
export async function getActiveObjectClaimForUpdate(db: DbOrTx, objectId: string): Promise<ObjectClaim | null> {
  const [claim] = await db
    .select()
    .from(iamObjectClaims)
    .where(and(eq(iamObjectClaims.objectId, objectId), isNull(iamObjectClaims.releasedAt)))
    .for("update");
  return claim ?? null;
}

/** The unreleased claims among these objects, locked in object ID order. */
export async function getActiveObjectClaimsForUpdate(db: DbOrTx, objectIds: string[]): Promise<ObjectClaim[]> {
  return db
    .select()
    .from(iamObjectClaims)
    .where(and(inArray(iamObjectClaims.objectId, objectIds), isNull(iamObjectClaims.releasedAt)))
    .orderBy(iamObjectClaims.objectId)
    .for("update");
}

/** Bytes a household is billed for among these objects, counting only unreleased claims. */
export async function getBilledBytes(db: DbOrTx, householdId: string, objectIds: string[]): Promise<bigint> {
  if (objectIds.length === 0) {
    return 0n;
  }
  const [row] = await db
    .select({ total: sum(iamObjectClaims.bytes) })
    .from(iamObjectClaims)
    .where(and(inArray(iamObjectClaims.objectId, objectIds), eq(iamObjectClaims.householdId, householdId), isNull(iamObjectClaims.releasedAt)));
  return BigInt(row?.total ?? 0);
}

/** Every unreleased object a household is billed for. */
export async function getActiveObjectIdsByHousehold(db: DbOrTx, householdId: string): Promise<string[]> {
  const rows = await db
    .select({ objectId: iamObjectClaims.objectId })
    .from(iamObjectClaims)
    .where(and(eq(iamObjectClaims.householdId, householdId), isNull(iamObjectClaims.releasedAt)));
  return rows.map((r) => r.objectId);
}
