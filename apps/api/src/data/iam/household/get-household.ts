import { eq, inArray } from "drizzle-orm";
import { isHouseholdRole } from "#/auth/role-checks.js";
import { member } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import type { DbOrTx } from "#/db/index.js";
import type { Household, HouseholdMembership } from "./types.js";

/** A user's one household, read from membership rather than the session, so it is always current. */
export async function getHouseholdByUserId(db: DbOrTx, userId: string): Promise<HouseholdMembership | null> {
  const [row] = await db
    .select({ householdId: member.organizationId, role: member.role, suspended: iamHouseholds.suspended })
    .from(member)
    .leftJoin(iamHouseholds, eq(iamHouseholds.householdId, member.organizationId))
    .where(eq(member.userId, userId))
    .limit(1);
  if (!row || !isHouseholdRole(row.role)) {
    return null;
  }
  return { householdId: row.householdId, role: row.role, suspended: row.suspended ?? false };
}

/** A household's allowance row, or null when it has none. */
export async function getHousehold(db: DbOrTx, householdId: string): Promise<Household | null> {
  const [household] = await db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId));
  return household ?? null;
}

/** A household row, locked until the transaction ends. Null when it does not exist. */
export async function getHouseholdForUpdate(db: DbOrTx, householdId: string): Promise<Household | null> {
  const [household] = await db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId)).for("update");
  return household ?? null;
}

/** Households by ID, locked in ID order so concurrent callers never wait on each other in a cycle. */
export async function getHouseholdsForUpdate(db: DbOrTx, householdIds: string[]): Promise<Household[]> {
  return db
    .select()
    .from(iamHouseholds)
    .where(inArray(iamHouseholds.householdId, householdIds))
    .orderBy(iamHouseholds.householdId)
    .for("update");
}
