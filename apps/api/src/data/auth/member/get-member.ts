import { HOUSEHOLD_OWNER_ROLE } from '#/auth/constants.js'
import type { User } from '#/data/auth/user/types.js'
import type { DbOrTx } from '#/db/index.js'
import { member, user } from '#/db/schemas/auth.js'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'

import type { Member, MemberWithUser } from './types.js'

/** The user who owns a household, or null if it has none. */
export async function getOwnerUserId(
  db: DbOrTx,
  organizationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.role, HOUSEHOLD_OWNER_ROLE),
      ),
    )
    .limit(1)
  return row?.userId ?? null
}

/** The Owner of each of these households that has one. */
export async function getOwnersByOrganizationIds(
  db: DbOrTx,
  organizationIds: string[],
): Promise<{ organizationId: string; user: User }[]> {
  return db
    .select({ organizationId: member.organizationId, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        inArray(member.organizationId, organizationIds),
        eq(member.role, HOUSEHOLD_OWNER_ROLE),
      ),
    )
}

/** How many members each of these households has. Households with none are left out. */
export async function countMembersByOrganizationIds(
  db: DbOrTx,
  organizationIds: string[],
): Promise<{ organizationId: string; count: number }[]> {
  return db
    .select({ organizationId: member.organizationId, count: count() })
    .from(member)
    .where(inArray(member.organizationId, organizationIds))
    .groupBy(member.organizationId)
}

/** A user's membership in this household, or null when they are not in it. */
export async function getMember(
  db: DbOrTx,
  organizationId: string,
  userId: string,
): Promise<Member | null> {
  const [row] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
  return row ?? null
}

/** Every member of a household with their user row, the Owner first, then by join time. */
export async function getMembersWithUsers(
  db: DbOrTx,
  organizationId: string,
): Promise<MemberWithUser[]> {
  return db
    .select({ member, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(
      desc(eq(member.role, HOUSEHOLD_OWNER_ROLE)),
      asc(member.createdAt),
      asc(member.id),
    )
}
