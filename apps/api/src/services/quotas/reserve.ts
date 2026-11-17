import { Code, ConnectError } from "@connectrpc/connect";
import { eq } from "drizzle-orm";
import { iamHouseholds, iamUploadReservations } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";
import { RESERVATION_TTL_MS, SHARED_LIBRARY_APPS } from "./constants.js";
import { plus } from "./sql.js";
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
  const grantId = input.billing.kind === "grant" ? input.billing.grantId : null;

  if (input.billing.kind === "shared") {
    if (!SHARED_LIBRARY_APPS.includes(input.app)) {
      throw new ConnectError(`${input.app} has no shared library`, Code.InvalidArgument);
    }
    const [row] = await ctx.db
      .insert(iamUploadReservations)
      .values({ householdId: null, userId: input.userId, app: input.app, bytes: input.sizeBytes, expiresAt })
      .returning({ id: iamUploadReservations.id });
    return { reservationId: row!.id, householdId: null, expiresAt };
  }

  const householdId = input.billing.householdId;
  return ctx.db.transaction(async (tx) => {
    const [household] = await tx
      .select()
      .from(iamHouseholds)
      .where(eq(iamHouseholds.householdId, householdId))
      .for("update");
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
    await tx
      .update(iamHouseholds)
      .set({ reservedBytes: plus(iamHouseholds.reservedBytes, input.sizeBytes) })
      .where(eq(iamHouseholds.householdId, householdId));
    const [row] = await tx
      .insert(iamUploadReservations)
      .values({ householdId, grantId, userId: input.userId, app: input.app, bytes: input.sizeBytes, expiresAt })
      .returning({ id: iamUploadReservations.id });
    return { reservationId: row!.id, householdId, expiresAt };
  });
}
