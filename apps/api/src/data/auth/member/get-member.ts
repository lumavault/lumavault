import { and, count, eq, inArray } from "drizzle-orm";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import type { DbOrTx } from "#/db/index.js";
import type { User } from "#/data/auth/user/types.js";
import { member, user } from "#/db/schemas/auth.js";

/** The user who owns a household, or null if it has none. */
export async function getOwnerUserId(db: DbOrTx, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, HOUSEHOLD_OWNER_ROLE)))
    .limit(1);
  return row?.userId ?? null;
}

/** The Owner of each of these households that has one. */
export async function getOwnersByOrganizationIds(db: DbOrTx, organizationIds: string[]): Promise<{ organizationId: string; user: User }[]> {
  return db
    .select({ organizationId: member.organizationId, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(inArray(member.organizationId, organizationIds), eq(member.role, HOUSEHOLD_OWNER_ROLE)));
}

/** How many members each of these households has. Households with none are left out. */
export async function countMembersByOrganizationIds(db: DbOrTx, organizationIds: string[]): Promise<{ organizationId: string; count: number }[]> {
  return db
    .select({ organizationId: member.organizationId, count: count() })
    .from(member)
    .where(inArray(member.organizationId, organizationIds))
    .groupBy(member.organizationId);
}
