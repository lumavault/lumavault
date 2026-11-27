import { randomUUID } from 'node:crypto'
import { HOUSEHOLD_OWNER_ROLE, type HouseholdRole } from '#/auth/constants.js'
import type { DbOrTx } from '#/db/index.js'
import { member, user } from '#/db/schemas/auth.js'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'

import type { User } from './user.js'

/** A Better Auth organization member row. */
export type Member = typeof member.$inferSelect

/** A household member with their user row. */
export interface MemberWithUser {
  member: Member
  user: User
}

export interface NewMember {
  organizationId: string
  userId: string
  role: string
  createdAt: Date
}

export async function createMember(
  db: DbOrTx,
  input: NewMember,
): Promise<void> {
  await db.insert(member).values({ id: randomUUID(), ...input })
}

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

/** Sets a member's role. Null when they are not in this household. */
export async function updateMemberRole(
  db: DbOrTx,
  organizationId: string,
  userId: string,
  role: HouseholdRole,
): Promise<Member | null> {
  const [row] = await db
    .update(member)
    .set({ role })
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
    .returning()
  return row ?? null
}
