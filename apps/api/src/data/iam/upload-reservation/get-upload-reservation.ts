import { and, asc, eq, lt, sql } from "drizzle-orm";
import { noRowsOnBadUuid } from "#/db/errors.js";
import type { DbOrTx } from "#/db/index.js";
import { iamUploadReservations } from "#/db/schemas/iam.js";
import type { UploadReservation } from "./types.js";

/** A reservation by ID. Null when it does not exist or the ID is not a UUID. */
export async function getUploadReservation(db: DbOrTx, reservationId: string): Promise<UploadReservation | null> {
  const [reservation] = await db
    .select()
    .from(iamUploadReservations)
    .where(eq(iamUploadReservations.id, sql`${reservationId}::uuid`))
    .catch(noRowsOnBadUuid);
  return reservation ?? null;
}

/** A reservation by ID, locked until the transaction ends. Null when it does not exist or the ID is not a UUID. */
export async function getUploadReservationForUpdate(db: DbOrTx, reservationId: string): Promise<UploadReservation | null> {
  const [reservation] = await db
    .select()
    .from(iamUploadReservations)
    .where(eq(iamUploadReservations.id, sql`${reservationId}::uuid`))
    .for("update")
    .catch(noRowsOnBadUuid);
  return reservation ?? null;
}

/** Pending reservations past their deadline, locked. Rows another transaction holds are skipped. */
export async function getExpiredUploadReservationsForUpdate(
  db: DbOrTx,
  now: Date,
  limit: number,
): Promise<Pick<UploadReservation, "id" | "householdId" | "bytes">[]> {
  return db
    .select({ id: iamUploadReservations.id, householdId: iamUploadReservations.householdId, bytes: iamUploadReservations.bytes })
    .from(iamUploadReservations)
    .where(and(eq(iamUploadReservations.status, "pending"), lt(iamUploadReservations.expiresAt, now)))
    .orderBy(asc(iamUploadReservations.id))
    .limit(limit)
    .for("update", { skipLocked: true });
}
