import { Code, ConnectError } from "@connectrpc/connect";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { iamHouseholds, iamObjectClaims } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";
import { minusFloor, plus, type Tx } from "./sql.js";
import type { MovedObjects } from "./types.js";

/**
 * Bills objects to another household instead of the one that holds them, all or nothing.
 * Used when a person moves and takes their private data along. Locks the claims, then both
 * households in a fixed order, and refuses the move if it would push the new household over
 * its cap. Objects already in the new household, or already released, are skipped.
 */
export async function moveObjects(
  ctx: Pick<ModuleContext, "db">,
  objectIds: string[],
  toHouseholdId: string,
): Promise<MovedObjects> {
  if (objectIds.length === 0) {
    return { bytes: 0n, count: 0 };
  }
  return ctx.db.transaction(async (tx) => {
    const claims = await tx
      .select()
      .from(iamObjectClaims)
      .where(and(inArray(iamObjectClaims.objectId, objectIds), isNull(iamObjectClaims.releasedAt)))
      .orderBy(iamObjectClaims.objectId)
      .for("update");
    const moving = claims.filter((c) => c.householdId !== toHouseholdId);
    const fromTotals = new Map<string, bigint>();
    let total = 0n;
    for (const c of moving) {
      total += c.bytes;
      if (c.householdId) fromTotals.set(c.householdId, (fromTotals.get(c.householdId) ?? 0n) + c.bytes);
    }

    const ids = [...new Set([...fromTotals.keys(), toHouseholdId])].sort();
    const locked = await lockHouseholds(tx, ids);
    const target = locked.get(toHouseholdId);
    if (!target) {
      throw new ConnectError("the new household has no allowance", Code.FailedPrecondition);
    }
    if (target.usedBytes + target.reservedBytes + total > target.storageCapBytes) {
      throw new ConnectError("the new household does not have room for this data", Code.ResourceExhausted);
    }

    for (const [householdId, bytes] of fromTotals) {
      await tx.update(iamHouseholds).set({ usedBytes: minusFloor(iamHouseholds.usedBytes, bytes) }).where(eq(iamHouseholds.householdId, householdId));
    }
    await tx.update(iamHouseholds).set({ usedBytes: plus(iamHouseholds.usedBytes, total) }).where(eq(iamHouseholds.householdId, toHouseholdId));
    if (moving.length > 0) {
      await tx
        .update(iamObjectClaims)
        .set({ householdId: toHouseholdId })
        .where(inArray(iamObjectClaims.objectId, moving.map((c) => c.objectId)));
    }
    return { bytes: total, count: moving.length };
  });
}

/**
 * Copies an object into another household as a new object billed to it, uploaded by userId.
 * The source household keeps its own. Refuses, and removes the copy, if it does not fit.
 */
export async function copyObjectToHousehold(
  ctx: Pick<ModuleContext, "db" | "gateway">,
  objectId: string,
  toHouseholdId: string,
  userId: string,
): Promise<{ objectId: string; bytes: bigint }> {
  const [source] = await ctx.db
    .select()
    .from(iamObjectClaims)
    .where(and(eq(iamObjectClaims.objectId, objectId), isNull(iamObjectClaims.releasedAt)));
  if (!source) {
    throw new ConnectError("no such object", Code.NotFound);
  }
  const copy = await ctx.gateway.copy(objectId);
  try {
    await ctx.db.transaction(async (tx) => {
      const [target] = await tx.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, toHouseholdId)).for("update");
      if (!target) {
        throw new ConnectError("the new household has no allowance", Code.FailedPrecondition);
      }
      if (target.usedBytes + target.reservedBytes + copy.sizeBytes > target.storageCapBytes) {
        throw new ConnectError("the new household does not have room for this copy", Code.ResourceExhausted);
      }
      await tx.update(iamHouseholds).set({ usedBytes: plus(iamHouseholds.usedBytes, copy.sizeBytes) }).where(eq(iamHouseholds.householdId, toHouseholdId));
      await tx.insert(iamObjectClaims).values({
        objectId: copy.id,
        householdId: toHouseholdId,
        uploadedBy: userId,
        app: source.app,
        bytes: copy.sizeBytes,
      });
    });
  } catch (err) {
    await ctx.gateway.delete(copy.id);
    throw err;
  }
  return { objectId: copy.id, bytes: copy.sizeBytes };
}

async function lockHouseholds(tx: Tx, ids: string[]) {
  const rows = await tx.select().from(iamHouseholds).where(inArray(iamHouseholds.householdId, ids)).orderBy(iamHouseholds.householdId).for("update");
  return new Map(rows.map((r) => [r.householdId, r]));
}
