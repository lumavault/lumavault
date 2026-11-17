import { Code, ConnectError } from "@connectrpc/connect";
import { and, eq, isNull, sql } from "drizzle-orm";
import { iamHouseholds, iamObjectClaims, iamUploadReservations } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";
import { notFoundOnBadUuid } from "./finish.js";
import { minusFloor } from "./sql.js";

/** Gives back a reservation that will not be finished. Cancelling twice is a no-op. */
export async function cancelReservation(
  ctx: Pick<ModuleContext, "db">,
  input: { userId: string; reservationId: string },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [res] = await tx
      .select()
      .from(iamUploadReservations)
      .where(eq(iamUploadReservations.id, sql`${input.reservationId}::uuid`))
      .for("update")
      .catch(notFoundOnBadUuid);
    if (!res) {
      throw new ConnectError("no such reservation", Code.NotFound);
    }
    if (res.userId !== input.userId) {
      throw new ConnectError("reservation belongs to someone else", Code.PermissionDenied);
    }
    if (res.status !== "pending") {
      return;
    }
    await tx.update(iamUploadReservations).set({ status: "cancelled", settledAt: new Date() }).where(eq(iamUploadReservations.id, res.id));
    if (res.householdId) {
      await tx
        .update(iamHouseholds)
        .set({ reservedBytes: minusFloor(iamHouseholds.reservedBytes, res.bytes) })
        .where(eq(iamHouseholds.householdId, res.householdId));
    }
  });
}

/**
 * Refunds the household that paid for an object, exactly once, then deletes the object from
 * the Gateway. Call it when an app deletes something for good. Locks the claim, then the household.
 */
export async function releaseObject(ctx: Pick<ModuleContext, "db" | "gateway">, objectId: string): Promise<{ refunded: bigint }> {
  const refunded = await ctx.db.transaction(async (tx) => {
    const [claim] = await tx
      .select()
      .from(iamObjectClaims)
      .where(and(eq(iamObjectClaims.objectId, objectId), isNull(iamObjectClaims.releasedAt)))
      .for("update");
    if (!claim) {
      return 0n;
    }
    await tx.update(iamObjectClaims).set({ releasedAt: new Date() }).where(eq(iamObjectClaims.objectId, objectId));
    if (claim.householdId) {
      await tx
        .update(iamHouseholds)
        .set({ usedBytes: minusFloor(iamHouseholds.usedBytes, claim.bytes) })
        .where(eq(iamHouseholds.householdId, claim.householdId));
    }
    return claim.householdId ? claim.bytes : 0n;
  });
  await ctx.gateway.delete(objectId);
  return { refunded };
}
