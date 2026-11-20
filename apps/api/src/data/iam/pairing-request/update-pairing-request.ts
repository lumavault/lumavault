import { and, eq, gt, sql } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamPairingRequests } from "#/db/schemas/iam.js";
import type { PairingRequest } from "./types.js";

/** Approves the pending, unexpired pairing with this code for a household. Null when there is none. */
export async function approvePairingRequestByCode(
  db: DbOrTx,
  code: string,
  input: { userId: string; householdId: string },
  now: Date,
): Promise<Pick<PairingRequest, "deviceName"> | null> {
  const [approved] = await db
    .update(iamPairingRequests)
    .set({ status: "approved", approvedBy: input.userId, householdId: input.householdId, approvedAt: now })
    .where(and(eq(iamPairingRequests.code, code), eq(iamPairingRequests.status, "pending"), gt(iamPairingRequests.expiresAt, now)))
    .returning({ deviceName: iamPairingRequests.deviceName });
  return approved ?? null;
}

/** Counts a wrong device secret, and expires the pairing once it reaches the limit. */
export async function recordFailedPairingAttempt(db: DbOrTx, pairingId: string, maxFailedAttempts: number): Promise<void> {
  await db
    .update(iamPairingRequests)
    .set({
      failedAttempts: sql`${iamPairingRequests.failedAttempts} + 1`,
      status: sql`case when ${iamPairingRequests.failedAttempts} + 1 >= ${maxFailedAttempts} then 'expired' else ${iamPairingRequests.status} end`,
    })
    .where(eq(iamPairingRequests.id, pairingId));
}

/** Claims an approved pairing, so two polls racing cannot both get a session. Null when it is no longer approved. */
export async function claimApprovedPairingRequest(db: DbOrTx, pairingId: string, now: Date): Promise<PairingRequest | null> {
  const [claimed] = await db
    .update(iamPairingRequests)
    .set({ status: "claimed", claimedAt: now })
    .where(and(eq(iamPairingRequests.id, pairingId), eq(iamPairingRequests.status, "approved")))
    .returning();
  return claimed ?? null;
}
