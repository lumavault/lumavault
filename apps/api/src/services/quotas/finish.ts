import { Code, ConnectError } from "@connectrpc/connect";
import { eq, sql } from "drizzle-orm";
import { iamHouseholds, iamObjectClaims, iamUploadReservations } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";
import { APP_NAMESPACE } from "./constants.js";
import { minusFloor, plus, type Tx } from "./sql.js";
import type { FinishedUpload, FinishInput } from "./types.js";

type Deps = Pick<ModuleContext, "db" | "gateway">;
type ReservationRow = typeof iamUploadReservations.$inferSelect;

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
    const [claimed] = await ctx.db
      .select({ objectId: iamObjectClaims.objectId })
      .from(iamObjectClaims)
      .where(eq(iamObjectClaims.objectId, input.objectId));
    if (!claimed) {
      await ctx.gateway.delete(input.objectId);
    }
    throw new ConnectError("household storage is full; the upload was removed", Code.ResourceExhausted);
  }
  return outcome.result;
}

async function loadReservation(ctx: Deps, input: FinishInput): Promise<ReservationRow> {
  const [reservation] = await ctx.db
    .select()
    .from(iamUploadReservations)
    .where(eq(iamUploadReservations.id, sql`${input.reservationId}::uuid`))
    .catch(notFoundOnBadUuid);
  if (!reservation) {
    throw new ConnectError("no such reservation", Code.NotFound);
  }
  if (reservation.userId !== input.userId) {
    throw new ConnectError("reservation belongs to someone else", Code.PermissionDenied);
  }
  return reservation;
}

type Outcome = { kind: "done"; result: FinishedUpload } | { kind: "over-cap" };

async function settle(tx: Tx, input: FinishInput, actual: bigint): Promise<Outcome> {
  const [res] = await tx
    .select()
    .from(iamUploadReservations)
    .where(eq(iamUploadReservations.id, input.reservationId))
    .for("update");
  if (!res) {
    throw new ConnectError("no such reservation", Code.NotFound);
  }

  const [existing] = await tx.select().from(iamObjectClaims).where(eq(iamObjectClaims.objectId, input.objectId));
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
    const [household] = await tx
      .select()
      .from(iamHouseholds)
      .where(eq(iamHouseholds.householdId, res.householdId))
      .for("update");
    if (!household) {
      throw new ConnectError("household no longer exists", Code.FailedPrecondition);
    }
    if (res.status === "pending") {
      await tx
        .update(iamHouseholds)
        .set({
          reservedBytes: minusFloor(iamHouseholds.reservedBytes, res.bytes),
          usedBytes: plus(iamHouseholds.usedBytes, actual),
        })
        .where(eq(iamHouseholds.householdId, res.householdId));
    } else {
      // The sweeper already refunded this reservation, so charge directly if it still fits.
      if (household.usedBytes + household.reservedBytes + actual > household.storageCapBytes) {
        await tx.update(iamUploadReservations).set({ status: "cancelled", settledAt: new Date() }).where(eq(iamUploadReservations.id, res.id));
        return { kind: "over-cap" };
      }
      await tx
        .update(iamHouseholds)
        .set({ usedBytes: plus(iamHouseholds.usedBytes, actual) })
        .where(eq(iamHouseholds.householdId, res.householdId));
    }
  }

  await tx
    .insert(iamObjectClaims)
    .values({
      objectId: input.objectId,
      householdId: res.householdId,
      uploadedBy: res.userId,
      reservationId: res.id,
      app: res.app,
      bytes: actual,
    })
    .catch((err: unknown) => {
      // Two finishes raced for one object; the first claim wins and this transaction rolls back.
      if ((err as { cause?: { code?: string } }).cause?.code === "23505") {
        throw new ConnectError("object is already claimed", Code.AlreadyExists);
      }
      throw err;
    });
  await tx.update(iamUploadReservations).set({ status: "finished", settledAt: new Date() }).where(eq(iamUploadReservations.id, res.id));
  return { kind: "done", result: { objectId: input.objectId, householdId: res.householdId, bytes: actual } };
}

// A malformed reservation ID is a reservation that does not exist.
export function notFoundOnBadUuid(err: unknown): never[] {
  if ((err as { cause?: { code?: string } }).cause?.code === "22P02") {
    return [];
  }
  throw err;
}
