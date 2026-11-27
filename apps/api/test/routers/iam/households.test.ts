import { Code, ConnectError } from '@connectrpc/connect'
import { Role } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import {
  HOUSEHOLD_ADMIN_ROLE,
  HOUSEHOLD_MEMBER_ROLE,
  HOUSEHOLD_OWNER_ROLE,
  type HouseholdRole,
} from '#/auth/constants.js'
import { createMember } from '#/data/auth/member/create-member.js'
import { createOrganization } from '#/data/auth/organization/create-organization.js'
import { createHousehold } from '#/data/iam/household/create-household.js'
import { createObjectClaim } from '#/data/iam/object-claim/create-object-claim.js'
import { member } from '#/db/schemas/auth.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { DEFAULT_MEMBER_LIMIT } from '#/iam/constants.js'
import { MEMBER_INVITE_PATH } from '#/routes.js'
import { createApp } from '#/server/app.js'
import { loadModules, type ModuleContext } from '#/server/modules.js'
import {
  createTestContext,
  recordingEmail,
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
import { and, eq, isNull } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let database: TestDatabase
let ctx: ModuleContext
let app: Hono
let email: ReturnType<typeof recordingEmail>
let counter = 0

async function codeOf(promise: Promise<unknown>): Promise<Code | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (err) {
    return ConnectError.from(err).code
  }
}

interface TestHousehold {
  id: string
  owner: TestUser
}

/** A household with a fresh Owner and the default member limit, created straight in the database. */
async function makeHousehold(): Promise<TestHousehold> {
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
    memberLimit: DEFAULT_MEMBER_LIMIT,
  })
  return { id: org.id, owner }
}

/** A new user added to the household with this role. */
async function addMember(
  household: TestHousehold,
  role: HouseholdRole,
): Promise<TestUser> {
  const user = await signUp(ctx, `member${++counter}@example.com`)
  await createMember(ctx.db, {
    organizationId: household.id,
    userId: user.id,
    role,
    createdAt: new Date(),
  })
  return user
}

async function roleOf(
  householdId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await ctx.db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, householdId), eq(member.userId, userId)),
    )
  return row?.role
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  email = recordingEmail()
  ctx = createTestContext(database, { email })
  app = createApp(ctx, await loadModules())
})

afterAll(async () => {
  await database.drop()
})

describe('ListMembers', () => {
  it('lists the Owner first, pending invites, and free seats', async () => {
    const h = await makeHousehold()
    const admin = await addMember(h, HOUSEHOLD_ADMIN_ROLE)
    await iamClient(app, h.owner.headers).inviteMember({
      email: 'Pending@Example.com',
      role: Role.MEMBER,
    })

    const res = await iamClient(app, admin.headers).listMembers({})
    expect(res.members.map((m) => [m.user?.id, m.role])).toEqual([
      [h.owner.id, Role.OWNER],
      [admin.id, Role.ADMIN],
    ])
    expect(res.pendingInvites.map((i) => [i.email, i.role])).toEqual([
      ['pending@example.com', Role.MEMBER],
    ])
    expect(res.seatsRemaining).toBe(DEFAULT_MEMBER_LIMIT - 3)
  })

  it('works for Members and refuses people outside a household', async () => {
    const h = await makeHousehold()
    const plain = await addMember(h, HOUSEHOLD_MEMBER_ROLE)
    expect(await codeOf(iamClient(app, plain.headers).listMembers({}))).toBe(
      'ok',
    )
    const outsider = await signUp(ctx, `outsider${++counter}@example.com`)
    expect(await codeOf(iamClient(app, outsider.headers).listMembers({}))).toBe(
      Code.FailedPrecondition,
    )
  })
})

describe('InviteMember', () => {
  it('emails a Portal link and returns it', async () => {
    const h = await makeHousehold()
    const res = await iamClient(app, h.owner.headers).inviteMember({
      email: 'new@example.com',
      role: Role.ADMIN,
    })
    expect(res.invite?.role).toBe(Role.ADMIN)
    expect(res.inviteUrl).toBe(
      `${TEST_WEB_ORIGIN}${MEMBER_INVITE_PATH}${res.invite?.id}`,
    )
    expect(email.sent.at(-1)).toEqual({
      kind: 'member-invite',
      to: 'new@example.com',
      url: res.inviteUrl,
    })
  })

  it('rejects a fifth invite with the default limit of 4, counting pending invites', async () => {
    const h = await makeHousehold()
    const client = iamClient(app, h.owner.headers)
    for (const n of [1, 2, 3]) {
      await client.inviteMember({
        email: `seat${n}@example.com`,
        role: Role.MEMBER,
      })
    }
    expect(
      await codeOf(
        client.inviteMember({ email: 'seat4@example.com', role: Role.MEMBER }),
      ),
    ).toBe(Code.ResourceExhausted)
    expect((await client.listMembers({})).seatsRemaining).toBe(0)
  })

  it('replaces an open invite to the same email instead of taking another seat', async () => {
    const h = await makeHousehold()
    const client = iamClient(app, h.owner.headers)
    const first = await client.inviteMember({
      email: 'again@example.com',
      role: Role.MEMBER,
    })
    const second = await client.inviteMember({
      email: 'again@example.com',
      role: Role.ADMIN,
    })
    const res = await client.listMembers({})
    expect(res.pendingInvites.map((i) => i.id)).toEqual([second.invite?.id])
    expect(second.invite?.id).not.toBe(first.invite?.id)
  })

  it('rejects existing members, the Owner role, and Members as inviters', async () => {
    const h = await makeHousehold()
    const plain = await addMember(h, HOUSEHOLD_MEMBER_ROLE)
    const client = iamClient(app, h.owner.headers)
    expect(
      await codeOf(
        client.inviteMember({ email: plain.email, role: Role.MEMBER }),
      ),
    ).toBe(Code.AlreadyExists)
    expect(
      await codeOf(
        client.inviteMember({ email: 'x@example.com', role: Role.OWNER }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        iamClient(app, plain.headers).inviteMember({
          email: 'y@example.com',
          role: Role.MEMBER,
        }),
      ),
    ).toBe(Code.PermissionDenied)
  })
})

describe('CancelMemberInvite', () => {
  it('frees the seat and refuses invites from other households', async () => {
    const h = await makeHousehold()
    const other = await makeHousehold()
    const client = iamClient(app, h.owner.headers)
    const { invite } = await client.inviteMember({
      email: 'cancel@example.com',
      role: Role.MEMBER,
    })

    expect(
      await codeOf(
        iamClient(app, other.owner.headers).cancelMemberInvite({
          inviteId: invite!.id,
        }),
      ),
    ).toBe(Code.NotFound)
    await client.cancelMemberInvite({ inviteId: invite!.id })
    const res = await client.listMembers({})
    expect(res.pendingInvites).toEqual([])
    expect(res.seatsRemaining).toBe(DEFAULT_MEMBER_LIMIT - 1)
  })
})

describe('UpdateMemberRole', () => {
  it('changes a member between Admin and Member', async () => {
    const h = await makeHousehold()
    const plain = await addMember(h, HOUSEHOLD_MEMBER_ROLE)
    const res = await iamClient(app, h.owner.headers).updateMemberRole({
      userId: plain.id,
      role: Role.ADMIN,
    })
    expect(res.member?.role).toBe(Role.ADMIN)
    expect(await roleOf(h.id, plain.id)).toBe(HOUSEHOLD_ADMIN_ROLE)
  })

  it("rejects changing the Owner's role or making someone Owner", async () => {
    const h = await makeHousehold()
    const admin = await addMember(h, HOUSEHOLD_ADMIN_ROLE)
    const client = iamClient(app, admin.headers)
    expect(
      await codeOf(
        client.updateMemberRole({ userId: h.owner.id, role: Role.MEMBER }),
      ),
    ).toBe(Code.FailedPrecondition)
    expect(
      await codeOf(
        client.updateMemberRole({ userId: admin.id, role: Role.OWNER }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(await roleOf(h.id, h.owner.id)).toBe(HOUSEHOLD_OWNER_ROLE)
  })
})

describe('TransferOwnership', () => {
  it('makes the new member Owner and the old Owner an Admin', async () => {
    const h = await makeHousehold()
    const plain = await addMember(h, HOUSEHOLD_MEMBER_ROLE)
    await iamClient(app, h.owner.headers).transferOwnership({
      userId: plain.id,
    })
    expect(await roleOf(h.id, plain.id)).toBe(HOUSEHOLD_OWNER_ROLE)
    expect(await roleOf(h.id, h.owner.id)).toBe(HOUSEHOLD_ADMIN_ROLE)
  })

  it('is Owner only and needs a member of the same household', async () => {
    const h = await makeHousehold()
    const other = await makeHousehold()
    const admin = await addMember(h, HOUSEHOLD_ADMIN_ROLE)
    expect(
      await codeOf(
        iamClient(app, admin.headers).transferOwnership({ userId: admin.id }),
      ),
    ).toBe(Code.PermissionDenied)
    expect(
      await codeOf(
        iamClient(app, h.owner.headers).transferOwnership({
          userId: other.owner.id,
        }),
      ),
    ).toBe(Code.NotFound)
  })
})
