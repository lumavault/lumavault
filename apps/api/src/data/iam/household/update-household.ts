import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import { minusFloor, plus } from "#/data/sql.js";

/** Holds more bytes against the household's cap. */
export async function addReservedBytes(db: DbOrTx, householdId: string, bytes: bigint): Promise<void> {
  await db.update(iamHouseholds).set({ reservedBytes: plus(iamHouseholds.reservedBytes, bytes) }).where(eq(iamHouseholds.householdId, householdId));
}

/** Gives back held bytes, never going below zero. */
export async function subtractReservedBytes(db: DbOrTx, householdId: string, bytes: bigint): Promise<void> {
  await db.update(iamHouseholds).set({ reservedBytes: minusFloor(iamHouseholds.reservedBytes, bytes) }).where(eq(iamHouseholds.householdId, householdId));
}

/** Bills more bytes to the household. */
export async function addUsedBytes(db: DbOrTx, householdId: string, bytes: bigint): Promise<void> {
  await db.update(iamHouseholds).set({ usedBytes: plus(iamHouseholds.usedBytes, bytes) }).where(eq(iamHouseholds.householdId, householdId));
}

/** Refunds billed bytes, never going below zero. */
export async function subtractUsedBytes(db: DbOrTx, householdId: string, bytes: bigint): Promise<void> {
  await db.update(iamHouseholds).set({ usedBytes: minusFloor(iamHouseholds.usedBytes, bytes) }).where(eq(iamHouseholds.householdId, householdId));
}

/**
 * Turns a reservation into billed usage in one statement. heldBytes is what the reservation
 * held (the size the client asked for); billedBytes is the object's real size on the Gateway,
 * which can be smaller, so the difference goes back to the household.
 */
export async function settleReservedBytes(
  db: DbOrTx,
  householdId: string,
  input: { heldBytes: bigint; billedBytes: bigint },
): Promise<void> {
  await db
    .update(iamHouseholds)
    .set({
      reservedBytes: minusFloor(iamHouseholds.reservedBytes, input.heldBytes),
      usedBytes: plus(iamHouseholds.usedBytes, input.billedBytes),
    })
    .where(eq(iamHouseholds.householdId, householdId));
}
