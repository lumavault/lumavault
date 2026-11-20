import { Code, ConnectError } from "@connectrpc/connect";
import { getHouseholdForUpdate } from "#/data/iam/household/get-household.js";
import { addUsedBytes, settleReservedBytes } from "#/data/iam/household/update-household.js";
import { createObjectClaim } from "#/data/iam/object-claim/create-object-claim.js";
import { getObjectClaim } from "#/data/iam/object-claim/get-object-claim.js";
import { getUploadReservation, getUploadReservationForUpdate } from "#/data/iam/upload-reservation/get-upload-reservation.js";
import type { UploadReservation } from "#/data/iam/upload-reservation/types.js";
import { settleUploadReservation } from "#/data/iam/upload-reservation/update-upload-reservation.js";
import { isUniqueViolation } from "#/db/errors.js";
import type { DbOrTx } from "#/db/index.js";
import type { ModuleContext } from "#/modules.js";
import { APP_NAMESPACE } from "./constants.js";
import type { FinishedUpload, FinishInput } from "./types.js";

type Deps = Pick<ModuleContext, "db" | "gateway">;

/**
 * Claims a committed Gateway object for a reservation and bills its real size, refunding the
 * rest. Locks the reservation, then the household. Finishing the same reservation with the
 * same object again returns the first result.
 */
export async function finishUpload(ctx: Deps, input: FinishInput): Promise<FinishedUpload> {
  const reservation = await loadReservation(ctx, input);
  const stored = await ctx.gateway.stat(input.objectId);
  if (!stored) {
    throw new ConnectError("object not found on the Storage Gateway", Code.NotFound);
  }
  if (stored.namespace !== APP_NAMESPACE[reservation.app]) {
    throw new ConnectError("object is in another app's namespace", Code.InvalidArgument);
  }
  if (stored.sizeBytes > reservation.bytes) {
    throw new ConnectError("object is larger than its reservation", Code.InvalidArgument);
  }

  const outcome = await ctx.db.transaction((tx) => settle(tx, input, stored.sizeBytes));
  if (outcome.kind === "over-cap") {
    // The household filled up while this upload was late. Remove the object so it does not
    // sit on disk unbilled, unless a concurrent finish claimed it in the meantime.
    if (!(await getObjectClaim(ctx.db, input.objectId))) {
      await ctx.gateway.delete(input.objectId);
    }
    throw new ConnectError("household storage is full; the upload was removed", Code.ResourceExhausted);
  }
  return outcome.result;
}

async function loadReservation(ctx: Deps, input: FinishInput): Promise<UploadReservation> {
  const reservation = await getUploadReservation(ctx.db, input.reservationId);
  if (!reservation) {
    throw new ConnectError("no such reservation", Code.NotFound);
  }
  if (reservation.userId !== input.userId) {
    throw new ConnectError("reservation belongs to someone else", Code.PermissionDenied);
  }
  return reservation;
}

type Outcome = { kind: "done"; result: FinishedUpload } | { kind: "over-cap" };

async function settle(tx: DbOrTx, input: FinishInput, actual: bigint): Promise<Outcome> {
  const res = await getUploadReservationForUpdate(tx, input.reservationId);
  if (!res) {
    throw new ConnectError("no such reservation", Code.NotFound);
  }

  const existing = await getObjectClaim(tx, input.objectId);
  if (existing) {
    if (existing.reservationId === res.id) {
      return { kind: "done", result: { objectId: input.objectId, householdId: existing.householdId, bytes: existing.bytes } };
    }
    throw new ConnectError("object is already claimed", Code.AlreadyExists);
  }
  if (res.status === "finished") {
    throw new ConnectError("reservation already finished with another object", Code.FailedPrecondition);
  }
  if (res.status === "cancelled") {
    throw new ConnectError("reservation was cancelled", Code.FailedPrecondition);
  }

  if (res.householdId) {
    const household = await getHouseholdForUpdate(tx, res.householdId);
    if (!household) {
      throw new ConnectError("household no longer exists", Code.FailedPrecondition);
    }
    if (res.status === "pending") {
      await settleReservedBytes(tx, res.householdId, { heldBytes: res.bytes, billedBytes: actual });
    } else {
      // The sweeper already refunded this reservation, so charge directly if it still fits.
      if (household.usedBytes + household.reservedBytes + actual > household.storageCapBytes) {
        await settleUploadReservation(tx, res.id, "cancelled");
        return { kind: "over-cap" };
      }
      await addUsedBytes(tx, res.householdId, actual);
    }
  }

  await createObjectClaim(tx, {
    objectId: input.objectId,
    householdId: res.householdId,
    uploadedBy: res.userId,
    reservationId: res.id,
    app: res.app,
    bytes: actual,
  })
    .catch((err: unknown) => {
      // Two finishes raced for one object; the first claim wins and this transaction rolls back.
      if (isUniqueViolation(err)) {
        throw new ConnectError("object is already claimed", Code.AlreadyExists);
      }
      throw err;
    });
  await settleUploadReservation(tx, res.id, "finished");
  return { kind: "done", result: { objectId: input.objectId, householdId: res.householdId, bytes: actual } };
}
