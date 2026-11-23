import { eq, inArray } from "drizzle-orm";
import { isHouseholdRole } from "#/auth/role-checks.js";
import type { Organization } from "#/data/auth/organization/types.js";
import { keysetAfter, keysetOrder, type PageCursor } from "#/data/sql.js";
import { member, organization } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import type { DbOrTx } from "#/db/index.js";
import type { Household, HouseholdMembership } from "./types.js";

/** A user's one household, read from membership rather than the session, so it is always current. */
export async function getHouseholdByUserId(db: DbOrTx, userId: string): Promise<HouseholdMembership | null> {
  const [row] = await db
    .select({ householdId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  if (!row || !isHouseholdRole(row.role)) {
    return null;
  }
  return { householdId: row.householdId, role: row.role };
}

/** A household row, or null when it has no allowance row. */
export async function getHouseholdById(db: DbOrTx, householdId: string): Promise<Household | null> {
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

/** A page of households in creation order, each with its organization row. */
export async function getHouseholdPage(
  db: DbOrTx,
  page: { after?: PageCursor; limit: number },
): Promise<{ organization: Organization; household: Household }[]> {
  return db
    .select({ organization, household: iamHouseholds })
    .from(iamHouseholds)
    .innerJoin(organization, eq(organization.id, iamHouseholds.householdId))
    .where(page.after ? keysetAfter(organization.createdAt, organization.id, page.after) : undefined)
    .orderBy(...keysetOrder(organization.createdAt, organization.id))
    .limit(page.limit);
}
