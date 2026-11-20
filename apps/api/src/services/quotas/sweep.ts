import { subtractReservedBytes } from "#/data/iam/household/update-household.js";
import { getExpiredUploadReservationsForUpdate } from "#/data/iam/upload-reservation/get-upload-reservation.js";
import { expireUploadReservations } from "#/data/iam/upload-reservation/update-upload-reservation.js";
import type { ModuleContext } from "#/modules.js";
import { SWEEP_BATCH_SIZE } from "./constants.js";

/**
 * Expires pending reservations past their deadline and refunds their households, exactly once.
 * Rows another transaction holds are skipped and picked up on the next sweep. Returns how
 * many reservations expired.
 */
export async function expireReservations(ctx: Pick<ModuleContext, "db">, now: Date = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const expired = await ctx.db.transaction(async (tx) => {
      const rows = await getExpiredUploadReservationsForUpdate(tx, now, SWEEP_BATCH_SIZE);
      if (rows.length === 0) {
        return 0;
      }
      await expireUploadReservations(tx, rows.map((r) => r.id), now);

      // Households are updated in a fixed order so two sweepers never wait on each other.
      const refunds = new Map<string, bigint>();
      for (const r of rows) {
        if (r.householdId) {
          refunds.set(r.householdId, (refunds.get(r.householdId) ?? 0n) + r.bytes);
        }
      }
      for (const householdId of [...refunds.keys()].sort()) {
        await subtractReservedBytes(tx, householdId, refunds.get(householdId)!);
      }
      return rows.length;
    });
    total += expired;
    if (expired < SWEEP_BATCH_SIZE) {
      return total;
    }
  }
}

