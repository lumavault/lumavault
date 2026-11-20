import { eq, inArray, sum } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamGracePeriods } from "#/db/schemas/iam.js";

/** The grace period of a user who left a household without joining another, or null. */
export async function getGracePeriodByUserId(db: DbOrTx, userId: string) {
  const [grace] = await db.select().from(iamGracePeriods).where(eq(iamGracePeriods.userId, userId));
  return grace ?? null;
}

/** Total bytes held for people in grace from one household. */
export async function getHeldBytesByHousehold(db: DbOrTx, householdId: string): Promise<bigint> {
  const [row] = await db.select({ total: sum(iamGracePeriods.heldBytes) }).from(iamGracePeriods).where(eq(iamGracePeriods.householdId, householdId));
  return BigInt(row?.total ?? 0);
}

/** Total bytes held for people in grace, per household. Households with none are left out. */
export async function getHeldBytesByHouseholds(db: DbOrTx, householdIds: string[]) {
  return db
    .select({ id: iamGracePeriods.householdId, total: sum(iamGracePeriods.heldBytes) })
    .from(iamGracePeriods)
    .where(inArray(iamGracePeriods.householdId, householdIds))
    .groupBy(iamGracePeriods.householdId);
}
