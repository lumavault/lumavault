import { Code, ConnectError } from "@connectrpc/connect";
import { getHouseholdForUpdate, getHouseholdsForUpdate } from "#/data/iam/household/get-household.js";
import { addUsedBytes, subtractUsedBytes } from "#/data/iam/household/update-household.js";
import { createObjectClaim } from "#/data/iam/object-claim/create-object-claim.js";
import { getActiveObjectClaim, getActiveObjectClaimsForUpdate } from "#/data/iam/object-claim/get-object-claim.js";
import { moveObjectClaims } from "#/data/iam/object-claim/update-object-claim.js";
import type { ModuleContext } from "#/modules.js";
import type { MovedObjects } from "./types.js";

/**
 * Bills objects to another household instead of the one that holds them, all or nothing.
 * Used when a person moves and takes their private data along, so every object must come
 * from fromHouseholdId. Objects already in the new household, or already released, are
 * skipped, so running a move twice is safe. Locks the claims, then both households in a fixed
 * order, and refuses the move if it would push the new household over its cap.
 */
export async function moveObjects(
  ctx: Pick<ModuleContext, "db">,
  objectIds: string[],
  fromHouseholdId: string,
  toHouseholdId: string,
): Promise<MovedObjects> {
  if (objectIds.length === 0) {
    return { bytes: 0n, count: 0 };
  }
  return ctx.db.transaction(async (tx) => {
    const claims = await getActiveObjectClaimsForUpdate(tx, objectIds);
    const moving = claims.filter((c) => c.householdId !== toHouseholdId);
    if (moving.some((c) => c.householdId !== fromHouseholdId)) {
      throw new ConnectError("every object must belong to the household it moves from", Code.FailedPrecondition);
    }
    const total = moving.reduce((sum, c) => sum + c.bytes, 0n);

    const locked = await getHouseholdsForUpdate(tx, [...new Set([fromHouseholdId, toHouseholdId])].sort());
    const target = locked.find((h) => h.householdId === toHouseholdId);
    if (!target) {
      throw new ConnectError("the new household has no allowance", Code.FailedPrecondition);
    }
    if (target.usedBytes + target.reservedBytes + total > target.storageCapBytes) {
      throw new ConnectError("the new household does not have room for this data", Code.ResourceExhausted);
    }
    if (moving.length === 0) {
      return { bytes: 0n, count: 0 };
    }

    await subtractUsedBytes(tx, fromHouseholdId, total);
    await addUsedBytes(tx, toHouseholdId, total);
    await moveObjectClaims(tx, moving.map((c) => c.objectId), toHouseholdId);
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
  const source = await getActiveObjectClaim(ctx.db, objectId);
  if (!source) {
    throw new ConnectError("no such object", Code.NotFound);
  }
  const copy = await ctx.gateway.copy(objectId);
  try {
    await ctx.db.transaction(async (tx) => {
      const target = await getHouseholdForUpdate(tx, toHouseholdId);
      if (!target) {
        throw new ConnectError("the new household has no allowance", Code.FailedPrecondition);
      }
      if (target.usedBytes + target.reservedBytes + copy.sizeBytes > target.storageCapBytes) {
        throw new ConnectError("the new household does not have room for this copy", Code.ResourceExhausted);
      }
      await addUsedBytes(tx, toHouseholdId, copy.sizeBytes);
      await createObjectClaim(tx, {
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
