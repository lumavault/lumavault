import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { iamHouseholds, iamUploadReservations } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";
import { SWEEP_BATCH_SIZE } from "./constants.js";
import { minusFloor } from "./sql.js";

/**
 * Expires pending reservations past their deadline and refunds their households, exactly once.
 * Rows another transaction holds are skipped and picked up on the next sweep. Returns how
 * many reservations expired.
 */
export async function expireReservations(ctx: Pick<ModuleContext, "db">, now: Date = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const expired = await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: iamUploadReservations.id, householdId: iamUploadReservations.householdId, bytes: iamUploadReservations.bytes })
        .from(iamUploadReservations)
        .where(and(eq(iamUploadReservations.status, "pending"), lt(iamUploadReservations.expiresAt, now)))
        .orderBy(asc(iamUploadReservations.id))
        .limit(SWEEP_BATCH_SIZE)
        .for("update", { skipLocked: true });
      if (rows.length === 0) {
        return 0;
      }
      await tx
        .update(iamUploadReservations)
        .set({ status: "expired", settledAt: now })
        .where(inArray(iamUploadReservations.id, rows.map((r) => r.id)));

      // Households are updated in a fixed order so two sweepers never wait on each other.
      const refunds = new Map<string, bigint>();
      for (const r of rows) {
        if (r.householdId) {
          refunds.set(r.householdId, (refunds.get(r.householdId) ?? 0n) + r.bytes);
        }
      }
      for (const householdId of [...refunds.keys()].sort()) {
        await tx
          .update(iamHouseholds)
          .set({ reservedBytes: minusFloor(iamHouseholds.reservedBytes, refunds.get(householdId)!) })
          .where(eq(iamHouseholds.householdId, householdId));
      }
      return rows.length;
    });
    total += expired;
    if (expired < SWEEP_BATCH_SIZE) {
      return total;
    }
  }
}

