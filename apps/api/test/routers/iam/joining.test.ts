import { Code, ConnectError } from '@connectrpc/connect'
import {
  App,
  InviteKind,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { HOUSEHOLD_ADMIN_ROLE, HOUSEHOLD_OWNER_ROLE } from '#/auth/constants.js'
import { createInvitation } from '#/data/auth/invitation.js'
import { createMember } from '#/data/auth/member.js'
import { createOrganization } from '#/data/auth/organization.js'
import { createHousehold } from '#/data/iam/household.js'
import { invitation, member } from '#/db/schemas/auth.js'
import { iamHouseholdInvites, iamHouseholds } from '#/db/schemas/iam.js'
import { hashSecret, newSecret } from '#/lib/secrets.js'
import { createApp } from '#/server/app.js'
import { loadModules, type ModuleContext } from '#/server/modules.js'
import {
  createTestContext,
  signUp,
  TEST_WEB_ORIGIN,
  type TestUser,
} from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { iamClient } from '#test/support/rpc.js'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let database: TestDatabase
let ctx: ModuleContext
let app: Hono
let superAdmin: TestUser
let counter = 0

const HOUR_MS = 3_600_000

async function failure(
  promise: Promise<unknown>,
): Promise<{ code: Code; message: string } | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (err) {
    const e = ConnectError.from(err)
    return { code: e.code, message: e.rawMessage }
  }
}

interface TestHousehold {
  id: string
  owner: TestUser
}

async function makeHousehold(memberLimit = 4): Promise<TestHousehold> {
  const n = ++counter
  const owner = await signUp(ctx, `owner${n}@example.com`)
  const org = await createOrganization(ctx.db, {
    name: `House ${n}`,
    createdAt: new Date(),
  })
  await createMember(ctx.db, {
    organizationId: org.id,
    userId: owner.id,
    role: HOUSEHOLD_OWNER_ROLE,
    createdAt: new Date(),
  })
  await createHousehold(ctx.db, {
    householdId: org.id,
    storageCapBytes: 10n ** 12n,
    enabledApps: ['photos'],
    memberLimit,
  })
  return { id: org.id, owner }
}

/** A member invite written straight to the database, so expired ones can be made too. */
async function memberInvite(
  h: TestHousehold,
  email: string,
  expiresAt = new Date(Date.now() + HOUR_MS),
) {
  return createInvitation(ctx.db, {
    organizationId: h.id,
    email,
    role: HOUSEHOLD_ADMIN_ROLE,
    inviterId: h.owner.id,
    expiresAt,
  })
}

/** A household creation invite and the secret its link carries. */
async function householdInvite(
  email: string,
  expiresAt = new Date(Date.now() + HOUR_MS),
) {
  const token = newSecret()
  const [row] = await ctx.db
    .insert(iamHouseholdInvites)
    .values({
      tokenHash: hashSecret(token),
      email,
      storageCapBytes: 5n * 10n ** 9n,
      enabledApps: ['photos', 'cinema'],
      memberLimit: 6,
      createdBy: superAdmin.id,
      expiresAt,
    })
    .returning()
  return { token, id: row!.id }
}

async function membershipsOf(userId: string) {
  return ctx.db.select().from(member).where(eq(member.userId, userId))
}

async function newUser(): Promise<TestUser> {
  return signUp(ctx, `joiner${++counter}@example.com`)
}

/** Signs up through the public endpoint, as someone arriving from an invite link would. */
async function signUpFromLink(address: string): Promise<TestUser> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
    body: JSON.stringify({
      name: 'Newcomer',
      email: address,
      password: 'correct horse battery',
    }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { token: string; user: { id: string } }
  return {
    id: body.user.id,
    email: address,
    headers: new Headers({ authorization: `Bearer ${body.token}` }),
  }
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  ctx = createTestContext(database)
  app = createApp(ctx, await loadModules())
  superAdmin = await signUp(ctx, 'root@example.com')
})

afterAll(async () => {
  await database?.drop()
})

describe('GetInvite', () => {
  it('describes a member invite to someone signed out', async () => {
    const h = await makeHousehold()
    const invite = await memberInvite(h, 'Guest@Example.com')
    const res = await iamClient(app).getInvite({
      invite: { invite: { case: 'memberInviteId', value: invite.id } },
    })
    expect(res.kind).toBe(InviteKind.MEMBER)
    expect(res.email).toBe('guest@example.com')
    expect(res.householdName).toMatch(/^House \d+$/)
    expect(res.inviterName).toBe(h.owner.email.split('@')[0])
    expect(res.role).toBe(Role.ADMIN)
    expect(res.expiresAt?.seconds).toBe(
      BigInt(Math.floor(invite.expiresAt.getTime() / 1000)),
    )
  })

  it('describes a household creation invite with no household name', async () => {
    const { token } = await householdInvite('founder@example.com')
    const res = await iamClient(app).getInvite({
      invite: { invite: { case: 'householdInviteToken', value: token } },
    })
    expect(res.kind).toBe(InviteKind.NEW_HOUSEHOLD)
    expect(res.email).toBe('founder@example.com')
    expect(res.inviterName).toBe('root')
    expect(res.householdName).toBe('')
    expect(res.role).toBe(Role.OWNER)
  })

  it('rejects an unknown or missing invite', async () => {
    const client = iamClient(app)
    expect(
      await failure(
        client.getInvite({
          invite: {
            invite: { case: 'householdInviteToken', value: newSecret() },
          },
        }),
      ),
    ).toMatchObject({
      code: Code.NotFound,
    })
    expect(await failure(client.getInvite({}))).toMatchObject({
      code: Code.InvalidArgument,
    })
  })
})

describe('JoinHousehold', () => {
  it('lets someone sign up from a household creation invite, name the household, and own it', async () => {
    const address = `founder${++counter}@example.com`
    const { token, id } = await householdInvite(address)
    const founder = await signUpFromLink(address)
    expect(await membershipsOf(founder.id)).toEqual([])

    const res = await iamClient(app, founder.headers).joinHousehold({
      invite: { invite: { case: 'householdInviteToken', value: token } },
      householdName: '  The Lakehouse ',
    })
    expect(res.household?.name).toBe('The Lakehouse')
    expect(res.household?.ownerUserId).toBe(founder.id)
    expect(res.household?.allowance).toMatchObject({
      storageCapBytes: 5n * 10n ** 9n,
      enabledApps: [App.PHOTOS, App.CINEMA],
      memberLimit: 6,
    })

    const rows = await membershipsOf(founder.id)
    expect(rows.map((r) => [r.organizationId, r.role])).toEqual([
      [res.household?.id, HOUSEHOLD_OWNER_ROLE],
    ])
    const [used] = await ctx.db
      .select()
      .from(iamHouseholdInvites)
      .where(eq(iamHouseholdInvites.id, id))
    expect(used).toMatchObject({
      redeemedBy: founder.id,
      householdId: res.household?.id,
    })
    expect(used?.redeemedAt).not.toBeNull()
  })

  it('requires a name for a new household', async () => {
    const user = await newUser()
    const { token } = await householdInvite(user.email)
    const res = await failure(
      iamClient(app, user.headers).joinHousehold({
        invite: { invite: { case: 'householdInviteToken', value: token } },
        householdName: ' ',
      }),
    )
    expect(res).toMatchObject({ code: Code.InvalidArgument })
    expect(await membershipsOf(user.id)).toEqual([])
  })

  it('adds an existing account with no household from a member invite and cancels its other invites', async () => {
    const h = await makeHousehold()
    const other = await makeHousehold()
    const user = await newUser()
    const invite = await memberInvite(h, user.email.toUpperCase())
    const otherInvite = await memberInvite(other, user.email)
    const { id: householdInviteId } = await householdInvite(user.email)

    const res = await iamClient(app, user.headers).joinHousehold({
      invite: { invite: { case: 'memberInviteId', value: invite.id } },
    })
    expect(res.household?.id).toBe(h.id)
    expect(res.household?.ownerUserId).toBe(h.owner.id)
    expect(
      (await membershipsOf(user.id)).map((r) => [r.organizationId, r.role]),
    ).toEqual([[h.id, HOUSEHOLD_ADMIN_ROLE]])

    const statuses = await ctx.db
      .select({ id: invitation.id, status: invitation.status })
      .from(invitation)
      .where(eq(invitation.inviterId, h.owner.id))
    expect(statuses).toEqual([{ id: invite.id, status: 'accepted' }])
    const [stale] = await ctx.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, otherInvite.id))
    expect(stale?.status).toBe('canceled')
    const [revoked] = await ctx.db
      .select()
      .from(iamHouseholdInvites)
      .where(eq(iamHouseholdInvites.id, householdInviteId))
    expect(revoked?.revokedAt).not.toBeNull()
  })

  it('refuses a member invite when the household has no free seat', async () => {
    const h = await makeHousehold(2)
    const user = await newUser()
    const invite = await memberInvite(h, user.email)
    // The Super-Admin lowers the limit after the invite went out, so the Owner fills every seat.
    await ctx.db
      .update(iamHouseholds)
      .set({ memberLimit: 1 })
      .where(eq(iamHouseholds.householdId, h.id))
    const res = await failure(
      iamClient(app, user.headers).joinHousehold({
        invite: { invite: { case: 'memberInviteId', value: invite.id } },
      }),
    )
    expect(res).toMatchObject({ code: Code.ResourceExhausted })
    expect(await membershipsOf(user.id)).toEqual([])
  })

  it('refuses a caller already in a household and changes nothing', async () => {
    const h = await makeHousehold()
    const other = await makeHousehold()
    const invite = await memberInvite(other, h.owner.email)
    const res = await failure(
      iamClient(app, h.owner.headers).joinHousehold({
        invite: { invite: { case: 'memberInviteId', value: invite.id } },
      }),
    )
    expect(res).toMatchObject({ code: Code.FailedPrecondition })
    expect(res !== 'ok' && res.message).toMatch(
      /moving between households is not supported yet/,
    )
    expect(
      (await membershipsOf(h.owner.id)).map((r) => r.organizationId),
    ).toEqual([h.id])
    const [still] = await ctx.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invite.id))
    expect(still?.status).toBe('pending')
  })

  it('gives expired, revoked, used, and wrong-email invites each their own reason', async () => {
    const h = await makeHousehold()
    const user = await newUser()
    const client = iamClient(app, user.headers)
    const join = (id: string) =>
      failure(
        client.joinHousehold({
          invite: { invite: { case: 'memberInviteId', value: id } },
        }),
      )

    const expired = await memberInvite(
      h,
      user.email,
      new Date(Date.now() - 1000),
    )
    const revoked = await memberInvite(h, user.email)
    await ctx.db
      .update(invitation)
      .set({ status: 'canceled' })
      .where(eq(invitation.id, revoked.id))
    const used = await memberInvite(h, user.email)
    await ctx.db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(eq(invitation.id, used.id))
    const wrong = await memberInvite(h, 'someone-else@example.com')

    const results = [
      await join(expired.id),
      await join(revoked.id),
      await join(used.id),
      await join(wrong.id),
    ]
    expect(results).toEqual([
      { code: Code.FailedPrecondition, message: 'invite has expired' },
      { code: Code.FailedPrecondition, message: 'invite was revoked' },
      { code: Code.FailedPrecondition, message: 'invite was already used' },
      {
        code: Code.PermissionDenied,
        message: 'this invite is for a different email address',
      },
    ])

    const expiredHousehold = await householdInvite(
      user.email,
      new Date(Date.now() - 1000),
    )
    expect(
      await failure(
        client.joinHousehold({
          invite: {
            invite: {
              case: 'householdInviteToken',
              value: expiredHousehold.token,
            },
          },
          householdName: 'X',
        }),
      ),
    ).toEqual({ code: Code.FailedPrecondition, message: 'invite has expired' })
    expect(await membershipsOf(user.id)).toEqual([])
  })

  it('does not let a household creation invite be used twice', async () => {
    const user = await newUser()
    const { token } = await householdInvite(user.email)
    const join = () =>
      iamClient(app, user.headers).joinHousehold({
        invite: { invite: { case: 'householdInviteToken', value: token } },
        householdName: 'Twice',
      })
    const results = await Promise.allSettled([join(), join()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await failure(join())).toMatchObject({
      code: Code.FailedPrecondition,
    })
    expect(await membershipsOf(user.id)).toHaveLength(1)
  })

  it('leaves exactly one membership when two invites are used at once', async () => {
    const a = await makeHousehold()
    const b = await makeHousehold()
    const user = await newUser()
    const first = await memberInvite(a, user.email)
    const second = await memberInvite(b, user.email)
    const client = iamClient(app, user.headers)
    const results = await Promise.allSettled([
      client.joinHousehold({
        invite: { invite: { case: 'memberInviteId', value: first.id } },
      }),
      client.joinHousehold({
        invite: { invite: { case: 'memberInviteId', value: second.id } },
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(
      ConnectError.from((rejected as PromiseRejectedResult).reason).code,
    ).toBe(Code.FailedPrecondition)
    expect(await membershipsOf(user.id)).toHaveLength(1)
  })

  it('requires sign-in', async () => {
    const h = await makeHousehold()
    const invite = await memberInvite(h, 'anon@example.com')
    expect(
      await failure(
        iamClient(app).joinHousehold({
          invite: { invite: { case: 'memberInviteId', value: invite.id } },
        }),
      ),
    ).toMatchObject({
      code: Code.Unauthenticated,
    })
  })
})
