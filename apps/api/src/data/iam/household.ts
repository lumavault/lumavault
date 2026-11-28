import type { HouseholdRole } from '#/auth/constants.js'
import { isHouseholdRole } from '#/auth/role-checks.js'
import type { Organization } from '#/data/auth/organization.js'
import {
  keysetAfter,
  keysetOrder,
  minusFloor,
  plus,
  type PageCursor,
} from '#/data/sql.js'
import type { DbOrTx } from '#/db/index.js'
import { member, organization } from '#/db/schemas/auth.js'
import { iamHouseholds } from '#/db/schemas/iam.js'
import type { IamApp } from '#/iam/constants.js'
import { eq } from 'drizzle-orm'

/** A household row: its allowance, usage and enabled apps. */
export type Household = typeof iamHouseholds.$inferSelect

/** A user's one household, their role in it, and the apps it has turned on. */
export interface HouseholdMembership {
  householdId: string
  role: HouseholdRole
  enabledApps: IamApp[]
}

/** What it takes to give a new household its allowance. Usage starts at zero. */
export type NewHousehold = Pick<
  typeof iamHouseholds.$inferInsert,
  'householdId' | 'storageCapBytes' | 'enabledApps' | 'memberLimit'
>

/** Fields of a household's allowance that the Super-Admin can change. */
export type AllowancePatch = Partial<
  Pick<Household, 'storageCapBytes' | 'enabledApps' | 'memberLimit'>
>

/** Inserts the allowance and usage row for a household that already has its organization. */
export async function createHousehold(
  db: DbOrTx,
  input: NewHousehold,
): Promise<Household> {
  const [row] = await db.insert(iamHouseholds).values(input).returning()
  return row!
}

/** A user's one household, read from membership rather than the session, so it is always current. */
export async function getHouseholdByUserId(
  db: DbOrTx,
  userId: string,
): Promise<HouseholdMembership | null> {
  const [row] = await db
    .select({
      householdId: member.organizationId,
      role: member.role,
      enabledApps: iamHouseholds.enabledApps,
    })
    .from(member)
    .leftJoin(
      iamHouseholds,
      eq(iamHouseholds.householdId, member.organizationId),
    )
    .where(eq(member.userId, userId))
    .limit(1)
  if (!row || !isHouseholdRole(row.role)) {
    return null
  }
  return {
    householdId: row.householdId,
    role: row.role,
    enabledApps: row.enabledApps ?? [],
  }
}

/** A household row, or null when it has no allowance row. */
export async function getHouseholdById(
  db: DbOrTx,
  householdId: string,
): Promise<Household | null> {
  const [household] = await db
    .select()
    .from(iamHouseholds)
    .where(eq(iamHouseholds.householdId, householdId))
  return household ?? null
}

/** A household row, locked until the transaction ends. Null when it does not exist. */
export async function getHouseholdForUpdate(
  db: DbOrTx,
  householdId: string,
): Promise<Household | null> {
  const [household] = await db
    .select()
    .from(iamHouseholds)
    .where(eq(iamHouseholds.householdId, householdId))
    .for('update')
  return household ?? null
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
    .where(
      page.after
        ? keysetAfter(organization.createdAt, organization.id, page.after)
        : undefined,
    )
    .orderBy(...keysetOrder(organization.createdAt, organization.id))
    .limit(page.limit)
}

/** Holds more bytes against the household's cap. */
export async function addReservedBytes(
  db: DbOrTx,
  householdId: string,
  bytes: bigint,
): Promise<void> {
  await db
    .update(iamHouseholds)
    .set({ reservedBytes: plus(iamHouseholds.reservedBytes, bytes) })
    .where(eq(iamHouseholds.householdId, householdId))
}

/** Gives back held bytes, never going below zero. */
export async function subtractReservedBytes(
  db: DbOrTx,
  householdId: string,
  bytes: bigint,
): Promise<void> {
  await db
    .update(iamHouseholds)
    .set({ reservedBytes: minusFloor(iamHouseholds.reservedBytes, bytes) })
    .where(eq(iamHouseholds.householdId, householdId))
}

/** Bills more bytes to the household. */
export async function addUsedBytes(
  db: DbOrTx,
  householdId: string,
  bytes: bigint,
): Promise<void> {
  await db
    .update(iamHouseholds)
    .set({ usedBytes: plus(iamHouseholds.usedBytes, bytes) })
    .where(eq(iamHouseholds.householdId, householdId))
}

/** Refunds billed bytes, never going below zero. */
export async function subtractUsedBytes(
  db: DbOrTx,
  householdId: string,
  bytes: bigint,
): Promise<void> {
  await db
    .update(iamHouseholds)
    .set({ usedBytes: minusFloor(iamHouseholds.usedBytes, bytes) })
    .where(eq(iamHouseholds.householdId, householdId))
}

/**
 * Turns a reservation into billed usage in one statement. heldBytes is what the reservation
 * held (the size the client asked for); billedBytes is the object's real size on the Gateway,
 * which can be smaller, so the difference goes back to the household.
 */
export async function settleReservedBytes(
  db: DbOrTx,
  householdId: string,
  input: { heldBytes: bigint; billedBytes: bigint },
): Promise<void> {
  await db
    .update(iamHouseholds)
    .set({
      reservedBytes: minusFloor(iamHouseholds.reservedBytes, input.heldBytes),
      usedBytes: plus(iamHouseholds.usedBytes, input.billedBytes),
    })
    .where(eq(iamHouseholds.householdId, householdId))
}

/** Changes the given allowance fields. Null when the household does not exist. */
export async function updateHouseholdAllowance(
  db: DbOrTx,
  householdId: string,
  patch: AllowancePatch,
): Promise<Household | null> {
  const [row] = await db
    .update(iamHouseholds)
    .set(patch)
    .where(eq(iamHouseholds.householdId, householdId))
    .returning()
  return row ?? null
}
