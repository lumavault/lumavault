import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamUploadReservations } from "#/db/schemas/iam.js";

/** Closes a reservation as cancelled or finished, stamped now. */
export async function settleUploadReservation(db: DbOrTx, reservationId: string, status: "cancelled" | "finished"): Promise<void> {
  await db.update(iamUploadReservations).set({ status, settledAt: new Date() }).where(eq(iamUploadReservations.id, reservationId));
}

/** Closes reservations as expired. */
export async function expireUploadReservations(db: DbOrTx, reservationIds: string[], now: Date): Promise<void> {
  await db.update(iamUploadReservations).set({ status: "expired", settledAt: now }).where(inArray(iamUploadReservations.id, reservationIds));
}
