import { eq, inArray, sum } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamGracePeriods } from "#/db/schemas/iam.js";
import type { GracePeriod } from "./types.js";

export async function getGracePeriodByUserId(db: DbOrTx, userId: string): Promise<GracePeriod | null> {
  const [row] = await db.select().from(iamGracePeriods).where(eq(iamGracePeriods.userId, userId));
  return row ?? null;
}

/** Bytes a household still holds for people in their grace period. */
export async function getHeldBytesByHousehold(db: DbOrTx, householdId: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sum(iamGracePeriods.heldBytes) })
    .from(iamGracePeriods)
    .where(eq(iamGracePeriods.householdId, householdId));
  return BigInt(row?.total ?? 0);
}

/** Held bytes for each of these households. Households holding none are left out. */
export async function getHeldBytesByHouseholdIds(db: DbOrTx, householdIds: string[]): Promise<{ householdId: string; heldBytes: bigint }[]> {
  const rows = await db
    .select({ householdId: iamGracePeriods.householdId, total: sum(iamGracePeriods.heldBytes) })
    .from(iamGracePeriods)
    .where(inArray(iamGracePeriods.householdId, householdIds))
    .groupBy(iamGracePeriods.householdId);
  return rows.map((r) => ({ householdId: r.householdId, heldBytes: BigInt(r.total ?? 0) }));
}
