import { Code, ConnectError } from "@connectrpc/connect";
import { getActiveObjectClaimForUpdate } from "#/data/iam/object-claim/get-object-claim.js";
import { markObjectClaimReleased } from "#/data/iam/object-claim/update-object-claim.js";
import { subtractReservedBytes, subtractUsedBytes } from "#/data/iam/household/update-household.js";
import { getUploadReservationForUpdate } from "#/data/iam/upload-reservation/get-upload-reservation.js";
import { settleUploadReservation } from "#/data/iam/upload-reservation/update-upload-reservation.js";
import type { ModuleContext } from "#/modules.js";

/** Gives back a reservation that will not be finished. Cancelling twice is a no-op. */
export async function cancelReservation(
  ctx: Pick<ModuleContext, "db">,
  input: { userId: string; reservationId: string },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const res = await getUploadReservationForUpdate(tx, input.reservationId);
    if (!res) {
      throw new ConnectError("no such reservation", Code.NotFound);
    }
    if (res.userId !== input.userId) {
      throw new ConnectError("reservation belongs to someone else", Code.PermissionDenied);
    }
    if (res.status !== "pending") {
      return;
    }
    await settleUploadReservation(tx, res.id, "cancelled");
    if (res.householdId) {
      await subtractReservedBytes(tx, res.householdId, res.bytes);
    }
  });
}

/**
 * Refunds the household that paid for an object, exactly once, then deletes the object from
 * the Gateway. Call it when an app deletes something for good. Locks the claim, then the household.
 */
export async function releaseObject(ctx: Pick<ModuleContext, "db" | "gateway">, objectId: string): Promise<{ refunded: bigint }> {
  const refunded = await ctx.db.transaction(async (tx) => {
    const claim = await getActiveObjectClaimForUpdate(tx, objectId);
    if (!claim) {
      return 0n;
    }
    await markObjectClaimReleased(tx, objectId);
    if (claim.householdId) {
      await subtractUsedBytes(tx, claim.householdId, claim.bytes);
    }
    return claim.householdId ? claim.bytes : 0n;
  });
  await ctx.gateway.delete(objectId);
  return { refunded };
}
