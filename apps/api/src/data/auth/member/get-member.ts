import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
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

/** One membership row, or null when the user is not in the organization. */
export async function getMember(db: DbOrTx, organizationId: string, userId: string) {
  const [row] = await db.select().from(member).where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
  return row ?? null;
}

/** The membership of the person with this email, matched ignoring case. */
export async function getMemberByEmail(db: DbOrTx, organizationId: string, email: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), sql`lower(${user.email}) = ${email.toLowerCase()}`));
  return row ?? null;
}

/** Members with their user rows, the Owner first, then by name. */
export async function listMembersWithUsers(db: DbOrTx, organizationId: string) {
  return db
    .select({ member, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(sql`${member.role} = ${HOUSEHOLD_OWNER_ROLE} desc`, asc(user.name));
}

/** How many people are in the organization. */
export async function countMembers(db: DbOrTx, organizationId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(member).where(eq(member.organizationId, organizationId));
  return row?.n ?? 0;
}

/** Everyone in the organization except one user, with their user rows. */
export async function listOtherMembersWithUsers(db: DbOrTx, organizationId: string, exceptUserId: string) {
  return db
    .select({ member, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), ne(member.userId, exceptUserId)));
}
