import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { iamUploadReservations } from '#/db/schemas/iam.js'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'

/** An upload reservation row. */
export type UploadReservation = typeof iamUploadReservations.$inferSelect

/** What it takes to hold bytes for a new upload. */
export type NewUploadReservation = Pick<
  typeof iamUploadReservations.$inferInsert,
  'householdId' | 'userId' | 'app' | 'bytes' | 'expiresAt'
>

/** Inserts a pending reservation and returns its ID. */
export async function createUploadReservation(
  db: DbOrTx,
  input: NewUploadReservation,
): Promise<string> {
  const [row] = await db
    .insert(iamUploadReservations)
    .values(input)
    .returning({ id: iamUploadReservations.id })
  return row!.id
}

/** A reservation by ID. Null when it does not exist or the ID is not a UUID. */
export async function getUploadReservation(
  db: DbOrTx,
  reservationId: string,
): Promise<UploadReservation | null> {
  const [reservation] = await db
    .select()
    .from(iamUploadReservations)
    .where(eq(iamUploadReservations.id, sql`${reservationId}::uuid`))
    .catch(noRowsOnBadUuid)
  return reservation ?? null
}

/** A reservation by ID, locked until the transaction ends. Null when it does not exist or the ID is not a UUID. */
export async function getUploadReservationForUpdate(
  db: DbOrTx,
  reservationId: string,
): Promise<UploadReservation | null> {
  const [reservation] = await db
    .select()
    .from(iamUploadReservations)
    .where(eq(iamUploadReservations.id, sql`${reservationId}::uuid`))
    .for('update')
    .catch(noRowsOnBadUuid)
  return reservation ?? null
}

/** Pending reservations past their deadline, locked. Rows another transaction holds are skipped. */
export async function getExpiredUploadReservationsForUpdate(
  db: DbOrTx,
  now: Date,
  limit: number,
): Promise<Pick<UploadReservation, 'id' | 'householdId' | 'bytes'>[]> {
  return db
    .select({
      id: iamUploadReservations.id,
      householdId: iamUploadReservations.householdId,
      bytes: iamUploadReservations.bytes,
    })
    .from(iamUploadReservations)
    .where(
      and(
        eq(iamUploadReservations.status, 'pending'),
        lt(iamUploadReservations.expiresAt, now),
      ),
    )
    .orderBy(asc(iamUploadReservations.id))
    .limit(limit)
    .for('update', { skipLocked: true })
}

/** Closes a reservation as cancelled or finished, stamped now. */
export async function settleUploadReservation(
  db: DbOrTx,
  reservationId: string,
  status: 'cancelled' | 'finished',
): Promise<void> {
  await db
    .update(iamUploadReservations)
    .set({ status, settledAt: new Date() })
    .where(eq(iamUploadReservations.id, reservationId))
}

/** Closes reservations as expired. */
export async function expireUploadReservations(
  db: DbOrTx,
  reservationIds: string[],
  now: Date,
): Promise<void> {
  await db
    .update(iamUploadReservations)
    .set({ status: 'expired', settledAt: now })
    .where(inArray(iamUploadReservations.id, reservationIds))
}
