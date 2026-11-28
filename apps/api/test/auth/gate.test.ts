import { HOUSEHOLD_MEMBER_ROLE } from '#/auth/constants.js'
import { isLockedAuthPath } from '#/auth/org-lockdown.js'
import { createHouseholdFor, mintBearerSession } from '#/auth/server-helpers.js'
import { joinFromMemberInvite } from '#/auth/sign-up-gate.js'
import { createInvitation } from '#/data/auth/invitation/create-invitation.js'
import { getInvitationForUpdate } from '#/data/auth/invitation/get-invitation.js'
import {
  cancelInvitation,
  markInvitationAccepted,
} from '#/data/auth/invitation/update-invitation.js'
import { createHousehold } from '#/data/iam/household/create-household.js'
import { invitation, member, user } from '#/db/schemas/auth.js'
import { iamHouseholdInvites } from '#/db/schemas/iam.js'
import { hashSecret, newSecret } from '#/lib/secrets.js'
import { createApp } from '#/server/app.js'
import { requestContext } from '#/server/context.js'
import { loadModules, type ModuleContext } from '#/server/modules.js'
import {
  createTestContext,
  rpcValues,
  signUp,
  TEST_WEB_ORIGIN,
  type TestUser,
} from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let database: TestDatabase
let ctx: ModuleContext
let app: Hono
let owner: TestUser

function signUpRequest(address: string) {
  return app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
    body: JSON.stringify({
      name: 'New',
      email: address,
      password: 'correct horse battery',
    }),
  })
}

async function householdInvite(
  email: string,
  overrides: Partial<typeof iamHouseholdInvites.$inferInsert> = {},
) {
  await database.db.insert(iamHouseholdInvites).values({
    tokenHash: hashSecret(newSecret()),
    email,
    storageCapBytes: 10n ** 9n,
    createdBy: owner.id,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  })
}

async function userId(address: string): Promise<string | undefined> {
  const [row] = await database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, address))
  return row?.id
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  ctx = createTestContext(database)
  app = createApp(ctx, await loadModules())
  owner = await signUp(ctx, 'owner@example.com')
})

afterAll(async () => {
  await database?.drop()
})

describe('sign-up gate', () => {
  it('rejects a stranger', async () => {
    expect((await signUpRequest('stranger@example.com')).status).toBe(403)
    expect(await userId('stranger@example.com')).toBeUndefined()
  })

  it('accepts the email a household creation invite was sent to, and no other', async () => {
    await householdInvite('invited@example.com')
    expect((await signUpRequest('someone-else@example.com')).status).toBe(403)
    expect((await signUpRequest('Invited@Example.com')).status).toBe(200)
  })

  it('rejects an expired, revoked, or redeemed household invite', async () => {
    const past = new Date(Date.now() - 1000)
    await householdInvite('expired@example.com', { expiresAt: past })
    await householdInvite('revoked@example.com', { revokedAt: past })
    await householdInvite('redeemed@example.com', { redeemedAt: past })
    for (const address of [
      'expired@example.com',
      'revoked@example.com',
      'redeemed@example.com',
    ]) {
      expect((await signUpRequest(address)).status, address).toBe(403)
    }
  })

  it('joins someone with a member invite to that household as they sign up', async () => {
    const household = await createHouseholdFor(ctx, owner.id, 'Home')
    await ctx.auth.api.createInvitation({
      body: {
        email: 'joiner@example.com',
        role: 'admin',
        organizationId: household.id,
      },
      headers: owner.headers,
    })
    expect((await signUpRequest('joiner@example.com')).status).toBe(200)

    const id = await userId('joiner@example.com')
    const rows = await database.db
      .select()
      .from(member)
      .where(eq(member.userId, id!))
    expect(rows).toEqual([
      expect.objectContaining({ organizationId: household.id, role: 'admin' }),
    ])
    const [invite] = await database.db
      .select()
      .from(invitation)
      .where(eq(invitation.email, 'joiner@example.com'))
    expect(invite?.status).toBe('accepted')
  })

  it('does not accept a canceled or expired member invite during joinFromMemberInvite', async () => {
    const household = await createHouseholdFor(ctx, owner.id, 'Closed')
    await createHousehold(database.db, {
      householdId: household.id,
      storageCapBytes: 10n ** 9n,
      enabledApps: ['photos'],
      memberLimit: 4,
    })
    const now = new Date()

    const canceledUser = await signUp(ctx, 'canceled-invite@example.com')
    const canceled = await createInvitation(database.db, {
      organizationId: household.id,
      email: canceledUser.email,
      role: HOUSEHOLD_MEMBER_ROLE,
      inviterId: owner.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    })
    await cancelInvitation(database.db, canceled.id)
    await joinFromMemberInvite(
      database.db,
      canceledUser.id,
      canceledUser.email,
      now,
    )
    expect(
      await markInvitationAccepted(database.db, canceled.id, now),
    ).toBeNull()
    expect(
      await database.db
        .select()
        .from(member)
        .where(eq(member.userId, canceledUser.id)),
    ).toEqual([])
    const [canceledRow] = await database.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, canceled.id))
    expect(canceledRow?.status).toBe('canceled')

    const expiredUser = await signUp(ctx, 'expired-invite@example.com')
    const expired = await createInvitation(database.db, {
      organizationId: household.id,
      email: expiredUser.email,
      role: HOUSEHOLD_MEMBER_ROLE,
      inviterId: owner.id,
      expiresAt: new Date(now.getTime() - 1000),
    })
    await joinFromMemberInvite(
      database.db,
      expiredUser.id,
      expiredUser.email,
      now,
    )
    expect(
      await markInvitationAccepted(database.db, expired.id, now),
    ).toBeNull()
    expect(
      await database.db
        .select()
        .from(member)
        .where(eq(member.userId, expiredUser.id)),
    ).toEqual([])
    const [expiredRow] = await database.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, expired.id))
    expect(expiredRow?.status).toBe('pending')
  })

  it('does not admit a member when a pending invite is canceled concurrently', async () => {
    const household = await createHouseholdFor(ctx, owner.id, 'Raced')
    await createHousehold(database.db, {
      householdId: household.id,
      storageCapBytes: 10n ** 9n,
      enabledApps: ['photos'],
      memberLimit: 4,
    })
    const racer = await signUp(ctx, 'racer@example.com')
    const invite = await createInvitation(database.db, {
      organizationId: household.id,
      email: racer.email,
      role: HOUSEHOLD_MEMBER_ROLE,
      inviterId: owner.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    let releaseLock!: () => void
    const inviteLocked = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    // Hold the row lock while joinFromMemberInvite reads the pending invite, then cancel it.
    const cancelTx = database.db.transaction(async (tx) => {
      await getInvitationForUpdate(tx, invite.id)
      releaseLock()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await cancelInvitation(tx, invite.id)
    })

    await inviteLocked
    await Promise.all([
      cancelTx,
      joinFromMemberInvite(database.db, racer.id, racer.email),
    ])

    expect(
      await database.db
        .select()
        .from(member)
        .where(eq(member.userId, racer.id)),
    ).toEqual([])
    const [inviteRow] = await database.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invite.id))
    expect(inviteRow?.status).toBe('canceled')
  })

  it('enforces memberLimit and defaults a null invite role to member', async () => {
    const fullHousehold = await createHouseholdFor(ctx, owner.id, 'Full')
    await createHousehold(database.db, {
      householdId: fullHousehold.id,
      storageCapBytes: 10n ** 9n,
      enabledApps: ['photos'],
      memberLimit: 1,
    })
    const overflow = await signUp(ctx, 'overflow@example.com')
    const fullInvite = await createInvitation(database.db, {
      organizationId: fullHousehold.id,
      email: overflow.email,
      role: HOUSEHOLD_MEMBER_ROLE,
      inviterId: owner.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    await joinFromMemberInvite(database.db, overflow.id, overflow.email)
    expect(
      await database.db
        .select()
        .from(member)
        .where(eq(member.userId, overflow.id)),
    ).toEqual([])
    const [stillPending] = await database.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, fullInvite.id))
    expect(stillPending?.status).toBe('pending')

    const openHousehold = await createHouseholdFor(ctx, owner.id, 'DefaultRole')
    await createHousehold(database.db, {
      householdId: openHousehold.id,
      storageCapBytes: 10n ** 9n,
      enabledApps: ['photos'],
      memberLimit: 4,
    })
    const newcomer = await signUp(ctx, 'default-role@example.com')
    await createInvitation(database.db, {
      organizationId: openHousehold.id,
      email: newcomer.email,
      role: null,
      inviterId: owner.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    await joinFromMemberInvite(database.db, newcomer.id, newcomer.email)
    expect(
      await database.db
        .select()
        .from(member)
        .where(eq(member.userId, newcomer.id)),
    ).toEqual([
      expect.objectContaining({
        organizationId: openHousehold.id,
        role: HOUSEHOLD_MEMBER_ROLE,
      }),
    ])
  })

  it('does not let a magic link create an account for an uninvited email', async () => {
    await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
      body: JSON.stringify({
        email: 'nobody@example.com',
        callbackURL: `${TEST_WEB_ORIGIN}/`,
      }),
    })
    expect(await userId('nobody@example.com')).toBeUndefined()
  })
})

describe('household endpoint lockdown', () => {
  it('rejects every client request to organization and admin endpoints', async () => {
    const paths = [
      ['POST', '/api/auth/organization/create'],
      ['POST', '/api/auth/organization/invite-member'],
      ['POST', '/api/auth/organization/update-member-role'],
      ['GET', '/api/auth/organization/list'],
      ['POST', '/api/auth/admin/ban-user'],
      ['GET', '/api/auth/admin/list-users'],
    ] as const
    for (const [method, path] of paths) {
      const res = await app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: TEST_WEB_ORIGIN,
          ...Object.fromEntries(owner.headers),
        },
        body: method === 'POST' ? '{}' : undefined,
      })
      expect(res.status, path).toBe(403)
    }
  })

  it('leaves sign-in and session routes open', () => {
    expect(isLockedAuthPath('/api/auth/sign-in/email')).toBe(false)
    expect(isLockedAuthPath('/api/auth/get-session')).toBe(false)
    expect(isLockedAuthPath('/api/auth/organization/create')).toBe(true)
  })

  it('still lets the server do the same actions', async () => {
    const someone = await signUp(ctx, 'server-made@example.com')
    const household = await createHouseholdFor(ctx, someone.id, 'Server-made')
    const members = await database.db
      .select()
      .from(member)
      .where(eq(member.organizationId, household.id))
    expect(members).toEqual([
      expect.objectContaining({ userId: someone.id, role: 'owner' }),
    ])
  })
})

describe('server helpers', () => {
  it('mintBearerSession opens a session for that user in their household', async () => {
    const tv = await signUp(ctx, 'tv-owner@example.com')
    const household = await createHouseholdFor(ctx, tv.id, 'Living Room')
    const token = await mintBearerSession(ctx, tv.id)
    const { household: theirs } = await requestContext(
      rpcValues(new Headers({ authorization: `Bearer ${token}` })),
      ctx,
    )
    expect(theirs).toMatchObject({ householdId: household.id, role: 'owner' })
  })
})
