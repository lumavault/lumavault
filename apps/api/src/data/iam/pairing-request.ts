import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { iamPairingRequests } from '#/db/schemas/iam.js'
import { and, eq, gt, ne, sql } from 'drizzle-orm'

/** A pairing request row. */
export type PairingRequest = typeof iamPairingRequests.$inferSelect

/** What it takes to start pairing an Apple TV. */
export type NewPairingRequest = Pick<
  typeof iamPairingRequests.$inferInsert,
  'code' | 'deviceSecretHash' | 'deviceName' | 'requesterIp' | 'expiresAt'
>

/** Who approved a pairing, and the household the Apple TV opens in. */
export interface PairingApproval {
  approvedBy: string
  householdId: string
}

/** Inserts a pending pairing request and returns its ID. Fails on a code another pending request holds. */
export async function createPairingRequest(
  db: DbOrTx,
  input: NewPairingRequest,
): Promise<string> {
  const [row] = await db
    .insert(iamPairingRequests)
    .values(input)
    .returning({ id: iamPairingRequests.id })
  return row!.id
}

/** A pairing request by ID. Null when it does not exist or the ID is not a UUID. */
export async function getPairingRequest(
  db: DbOrTx,
  pairingId: string,
): Promise<PairingRequest | null> {
  const [row] = await db
    .select()
    .from(iamPairingRequests)
    .where(eq(iamPairingRequests.id, uuid(pairingId)))
    .catch(noRowsOnBadUuid)
  return row ?? null
}

/** Approves the pending, unexpired request holding code. Null when no such request exists. */
export async function approvePairingRequestByCode(
  db: DbOrTx,
  code: string,
  approval: PairingApproval,
  now: Date,
): Promise<Pick<PairingRequest, 'id' | 'deviceName'> | null> {
  const [row] = await db
    .update(iamPairingRequests)
    .set({
      status: 'approved',
      approvedBy: approval.approvedBy,
      householdId: approval.householdId,
      approvedAt: now,
    })
    .where(
      and(
        eq(iamPairingRequests.code, code),
        eq(iamPairingRequests.status, 'pending'),
        gt(iamPairingRequests.expiresAt, now),
      ),
    )
    .returning({
      id: iamPairingRequests.id,
      deviceName: iamPairingRequests.deviceName,
    })
  return row ?? null
}

/**
 * Marks an approved, unexpired request claimed and returns it. The status check in the same
 * statement means only one of several racing callers gets the row.
 */
export async function claimPairingRequest(
  db: DbOrTx,
  pairingId: string,
  now: Date,
): Promise<PairingRequest | null> {
  const [row] = await db
    .update(iamPairingRequests)
    .set({ status: 'claimed', claimedAt: now })
    .where(
      and(
        eq(iamPairingRequests.id, pairingId),
        eq(iamPairingRequests.status, 'approved'),
        gt(iamPairingRequests.expiresAt, now),
      ),
    )
    .returning()
  return row ?? null
}

/** Counts a wrong device secret, and burns the request once it reaches maxAttempts. */
export async function recordFailedPairingAttempt(
  db: DbOrTx,
  pairingId: string,
  maxAttempts: number,
): Promise<void> {
  await db
    .update(iamPairingRequests)
    .set({
      failedAttempts: sql`${iamPairingRequests.failedAttempts} + 1`,
      status: sql`case when ${iamPairingRequests.failedAttempts} + 1 >= ${maxAttempts} then 'expired'::iam.pairing_status else ${iamPairingRequests.status} end`,
    })
    .where(
      and(
        eq(iamPairingRequests.id, pairingId),
        ne(iamPairingRequests.status, 'claimed'),
      ),
    )
}
