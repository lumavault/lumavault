import { randomUUID } from 'node:crypto'
import { getHouseholdByUserId } from '#/data/iam/household/get-household.js'
import { member, organization } from '#/db/schemas/auth.js'
import { iamHouseholds } from '#/db/schemas/iam.js'
import { createTestContext, signUp } from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let database: TestDatabase
let userId: string
let strangerId: string

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  const ctx = createTestContext(database)
  userId = (await signUp(ctx, 'alice@example.com')).id
  strangerId = (await signUp(ctx, 'stranger@example.com')).id
})

afterAll(async () => {
  await database?.drop()
})

async function addHousehold(
  db: Parameters<typeof getHouseholdByUserId>[0],
  role: string,
): Promise<string> {
  const householdId = randomUUID()
  await db.insert(organization).values({
    id: householdId,
    name: 'Home',
    slug: householdId,
    createdAt: new Date(),
  })
  await db.insert(iamHouseholds).values({ householdId })
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: householdId,
    userId,
    role,
    createdAt: new Date(),
  })
  return householdId
}

describe('getHouseholdByUserId', () => {
  it('is null for a user in no household', async () => {
    expect(await getHouseholdByUserId(database.db, strangerId)).toBeNull()
  })

  it('is null when the stored role is not a household role', async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await addHousehold(tx, 'superuser')
        expect(await getHouseholdByUserId(tx, userId)).toBeNull()
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
  })

  it('sees uncommitted work when given the transaction, and the pool does not', async () => {
    await expect(
      database.db.transaction(async (tx) => {
        const householdId = await addHousehold(tx, 'owner')
        expect(await getHouseholdByUserId(tx, userId)).toEqual({
          householdId,
          role: 'owner',
          enabledApps: [],
        })
        expect(await getHouseholdByUserId(database.db, userId)).toBeNull()
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await getHouseholdByUserId(database.db, userId)).toBeNull()
  })

  it("returns the household's enabled apps", async () => {
    await expect(
      database.db.transaction(async (tx) => {
        const householdId = await addHousehold(tx, 'member')
        await tx
          .update(iamHouseholds)
          .set({ enabledApps: ['cinema', 'photos'] })
          .where(eq(iamHouseholds.householdId, householdId))
        expect((await getHouseholdByUserId(tx, userId))?.enabledApps).toEqual([
          'cinema',
          'photos',
        ])
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
  })
})
