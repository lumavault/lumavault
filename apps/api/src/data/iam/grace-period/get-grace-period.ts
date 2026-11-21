import { eq, sum } from "drizzle-orm";
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
