import { and, count, eq, inArray } from "drizzle-orm";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import type { DbOrTx } from "#/db/index.js";
import { member, user } from "#/db/schemas/auth.js";

/** The user ID of the household's Owner, or null when it somehow has none. */
export async function getOwnerUserId(db: DbOrTx, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, HOUSEHOLD_OWNER_ROLE)))
    .limit(1);
  return row?.userId ?? null;
}

/** How many members each of these organizations has. Organizations with none are left out. */
export async function countMembersByOrganization(db: DbOrTx, organizationIds: string[]) {
  return db
    .select({ id: member.organizationId, n: count() })
    .from(member)
    .where(inArray(member.organizationId, organizationIds))
    .groupBy(member.organizationId);
}

/** The Owner of each of these organizations, with their user row. */
export async function listOwnersByOrganization(db: DbOrTx, organizationIds: string[]) {
  return db
    .select({ householdId: member.organizationId, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(inArray(member.organizationId, organizationIds), eq(member.role, HOUSEHOLD_OWNER_ROLE)));
}
