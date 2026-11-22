import { getBilledBytes } from "#/data/iam/object-claim/get-object-claim.js";
import { upsertGracePeriod } from "#/data/iam/grace-period/create-grace-period.js";
import type { GracePeriod } from "#/data/iam/grace-period/types.js";
import type { DbOrTx } from "#/db/index.js";
import type { AppDataHooks } from "./app-data.js";
import { GRACE_PERIOD_MS } from "./constants.js";

/** Bytes the household is billed for this person's private data, across every app. */
export async function privateBytes(db: DbOrTx, apps: AppDataHooks[], userId: string, householdId: string): Promise<bigint> {
  const lists = await Promise.all(apps.map((a) => a.privateObjects(db, userId, householdId)));
  return getBilledBytes(db, householdId, [...new Set(lists.flat())]);
}

/**
 * Starts a person's grace period after they leave or are removed. Their private data stays in
 * the household and is still billed to it, so its bytes are recorded as held, not refunded.
 */
export async function startGracePeriod(
  db: DbOrTx,
  apps: AppDataHooks[],
  input: { userId: string; householdId: string; householdName: string; now: Date },
): Promise<GracePeriod> {
  return upsertGracePeriod(db, {
    userId: input.userId,
    householdId: input.householdId,
    householdName: input.householdName,
    heldBytes: await privateBytes(db, apps, input.userId, input.householdId),
    startedAt: input.now,
    deleteAt: new Date(input.now.getTime() + GRACE_PERIOD_MS),
  });
}
