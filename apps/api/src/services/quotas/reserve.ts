import { Code, ConnectError } from "@connectrpc/connect";
import { getHouseholdForUpdate } from "#/data/iam/household/get-household.js";
import { addReservedBytes } from "#/data/iam/household/update-household.js";
import { createUploadReservation } from "#/data/iam/upload-reservation/create-upload-reservation.js";
import type { ModuleContext } from "#/modules.js";
import { RESERVATION_TTL_MS, SHARED_LIBRARY_APPS } from "./constants.js";
import type { Reservation, ReserveInput } from "./types.js";

/**
 * Holds sizeBytes against the payer's cap until the upload finishes, is cancelled, or the
 * sweeper expires it. Locks only the household row, so it cannot deadlock with finishes,
 * which lock their reservation first.
 */
export async function reserveUpload(ctx: Pick<ModuleContext, "db">, input: ReserveInput): Promise<Reservation> {
  if (input.sizeBytes <= 0n) {
    throw new ConnectError("size must be positive", Code.InvalidArgument);
  }
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

  if (input.billing.kind === "shared") {
    if (!SHARED_LIBRARY_APPS.includes(input.app)) {
      throw new ConnectError(`${input.app} has no shared library`, Code.InvalidArgument);
    }
    const reservationId = await createUploadReservation(ctx.db, {
      householdId: null,
      userId: input.userId,
      app: input.app,
      bytes: input.sizeBytes,
      expiresAt,
    });
    return { reservationId, householdId: null, expiresAt };
  }

  const householdId = input.billing.householdId;
  return ctx.db.transaction(async (tx) => {
    const household = await getHouseholdForUpdate(tx, householdId);
    if (!household) {
      throw new ConnectError("household has no allowance", Code.FailedPrecondition);
    }
    if (household.suspended) {
      throw new ConnectError("household is suspended", Code.PermissionDenied);
    }
    if (!household.enabledApps.includes(input.app)) {
      throw new ConnectError(`${input.app} is not enabled for this household`, Code.FailedPrecondition);
    }
    const committed = household.usedBytes + household.reservedBytes;
    if (committed + input.sizeBytes > household.storageCapBytes) {
      throw new ConnectError("household storage is full", Code.ResourceExhausted);
    }
    await addReservedBytes(tx, householdId, input.sizeBytes);
    const reservationId = await createUploadReservation(tx, {
      householdId,
      userId: input.userId,
      app: input.app,
      bytes: input.sizeBytes,
      expiresAt,
    });
    return { reservationId, householdId, expiresAt };
  });
}
