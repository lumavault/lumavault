import { Code, ConnectError } from '@connectrpc/connect'
import {
  IamService,
  type Allowance,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { getUsers } from '#/data/auth/user/get-user.js'
import { createHouseholdInvite } from '#/data/iam/household-invite/create-household-invite.js'
import {
  getHouseholdInviteForUpdate,
  getOpenHouseholdInvites,
} from '#/data/iam/household-invite/get-household-invite.js'
import {
  revokeHouseholdInvite,
  revokeUnusedHouseholdInvitesByEmail,
} from '#/data/iam/household-invite/update-household-invite.js'
import type { AllowancePatch, Household } from '#/data/iam/household/types.js'
import { updateHouseholdAllowance } from '#/data/iam/household/update-household.js'
import type { DbOrTx } from '#/db/index.js'
import { requireSuperAdmin } from '#/guards.js'
import {
  DEFAULT_MEMBER_LIMIT,
  HOUSEHOLD_INVITE_TTL_MS,
  MAX_MEMBER_LIMIT,
  MAX_STORAGE_CAP_BYTES,
} from '#/iam/constants.js'
import { paged } from '#/lib/paging.js'
import { hashSecret, newSecret } from '#/lib/secrets.js'
import { emailSchema, uuidSchema } from '#/lib/validation.js'
import { HOUSEHOLD_INVITE_PATH } from '#/routes.js'
import type { ApiModule } from '#/server/modules.js'
import {
  getHouseholdSummaries,
  getHouseholdView,
} from '#/services/households.js'

import {
  appsFromWire,
  householdInviteToWire,
  householdSummaryToWire,
  householdViewToWire,
  required,
  userToWire,
} from './convert.js'

// Allowance fields, by their update_mask path.

function storageCap(bytes: bigint): bigint {
  if (bytes <= 0n || bytes > MAX_STORAGE_CAP_BYTES) {
    throw new ConnectError(
      `storage_cap_bytes must be between 1 and ${MAX_STORAGE_CAP_BYTES}`,
      Code.InvalidArgument,
    )
  }
  return bytes
}

function enabledApps(apps: Allowance['enabledApps']): Household['enabledApps'] {
  const parsed = appsFromWire(apps)
  if (parsed.length === 0) {
    throw new ConnectError(
      'enabled_apps must name at least one app',
      Code.InvalidArgument,
    )
  }
  return parsed
}

function memberLimit(limit: number): number {
  if (limit < 1 || limit > MAX_MEMBER_LIMIT) {
    throw new ConnectError(
      `member_limit must be between 1 and ${MAX_MEMBER_LIMIT}`,
      Code.InvalidArgument,
    )
  }
  return limit
}

const ALLOWANCE_FIELDS = {
  storage_cap_bytes: (a: Allowance): AllowancePatch => ({
    storageCapBytes: storageCap(a.storageCapBytes),
  }),
  enabled_apps: (a: Allowance): AllowancePatch => ({
    enabledApps: enabledApps(a.enabledApps),
  }),
  member_limit: (a: Allowance): AllowancePatch => ({
    memberLimit: memberLimit(a.memberLimit),
  }),
} as const

/** The masked allowance fields, checked. An empty mask means every field. */
function allowancePatch(
  allowance: Allowance | undefined,
  paths: string[],
): AllowancePatch {
  if (!allowance) {
    throw new ConnectError('allowance is required', Code.InvalidArgument)
  }
  const fields = paths.length > 0 ? paths : Object.keys(ALLOWANCE_FIELDS)
  let patch: AllowancePatch = {}
  for (const path of fields) {
    if (!Object.hasOwn(ALLOWANCE_FIELDS, path)) {
      throw new ConnectError(
        `update_mask has unknown path ${path}`,
        Code.InvalidArgument,
      )
    }
    patch = {
      ...patch,
      ...ALLOWANCE_FIELDS[path as keyof typeof ALLOWANCE_FIELDS](allowance),
    }
  }
  return patch
}

/** The household as sent on the wire. NotFound when its organization is gone. */
async function householdWire(db: DbOrTx, household: Household) {
  const view = await getHouseholdView(db, household)
  if (!view) {
    throw new ConnectError('household not found', Code.NotFound)
  }
  return householdViewToWire(view)
}

// Every call here is for the server owner only. Writes go straight to Postgres in one
// transaction, as first-run setup does, so a failure partway leaves nothing behind.
export const module: ApiModule = {
  name: 'iam-admin',
  rpc(router, ctx) {
    router.rpc(IamService.method.createHouseholdInvite, async (req, call) => {
      const viewer = await requireSuperAdmin(call, ctx)
      const email = required(req.email, 'email').toLowerCase()
      if (!emailSchema.safeParse(email).success) {
        throw new ConnectError(
          'email is not a valid address',
          Code.InvalidArgument,
        )
      }
      if (!req.allowance) {
        throw new ConnectError('allowance is required', Code.InvalidArgument)
      }
      const allowance = {
        storageCapBytes: storageCap(req.allowance.storageCapBytes),
        enabledApps: enabledApps(req.allowance.enabledApps),
        memberLimit:
          req.allowance.memberLimit === 0
            ? DEFAULT_MEMBER_LIMIT
            : memberLimit(req.allowance.memberLimit),
      }
      const token = newSecret()
      const now = new Date()

      // One open invite per email, so sending again replaces a link that went astray.
      const invite = await ctx.db.transaction(async (tx) => {
        await revokeUnusedHouseholdInvitesByEmail(tx, email, now)
        return createHouseholdInvite(tx, {
          ...allowance,
          tokenHash: hashSecret(token),
          email,
          note: req.note.trim(),
          createdBy: viewer.userId,
          expiresAt: new Date(now.getTime() + HOUSEHOLD_INVITE_TTL_MS),
        })
      })

      const inviteUrl = `${ctx.config.portalUrl.replace(/\/+$/, '')}${HOUSEHOLD_INVITE_PATH}${token}`
      // The link is returned below either way, so a mail failure must not lose it.
      try {
        await ctx.email.sendHouseholdInvite(email, {
          url: inviteUrl,
          inviterName: viewer.name,
        })
      } catch (err) {
        console.error(
          'household invite created but its email failed to send',
          err,
        )
      }
      return { invite: householdInviteToWire(invite), inviteUrl }
    })

    router.rpc(IamService.method.listHouseholdInvites, async (_req, call) => {
      await requireSuperAdmin(call, ctx)
      const invites = await getOpenHouseholdInvites(ctx.db, new Date())
      return { invites: invites.map(householdInviteToWire) }
    })

    router.rpc(IamService.method.revokeHouseholdInvite, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      if (!uuidSchema.safeParse(req.inviteId).success) {
        throw new ConnectError(
          'invite_id is not a valid ID',
          Code.InvalidArgument,
        )
      }
      await ctx.db.transaction(async (tx) => {
        const invite = await getHouseholdInviteForUpdate(tx, req.inviteId)
        if (!invite) {
          throw new ConnectError('invite not found', Code.NotFound)
        }
        if (invite.redeemedAt) {
          throw new ConnectError(
            'invite was already used',
            Code.FailedPrecondition,
          )
        }
        if (!invite.revokedAt) {
          await revokeHouseholdInvite(tx, invite.id, new Date())
        }
      })
      return {}
    })

    router.rpc(IamService.method.listHouseholds, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const now = new Date()
      const { rows, nextPageToken } = await paged(
        req,
        (after, limit) => getHouseholdSummaries(ctx.db, { after, limit, now }),
        (s) => ({ createdAt: s.organization.createdAt, id: s.organization.id }),
      )
      return { households: rows.map(householdSummaryToWire), nextPageToken }
    })

    router.rpc(
      IamService.method.updateHouseholdAllowance,
      async (req, call) => {
        await requireSuperAdmin(call, ctx)
        const householdId = required(req.householdId, 'household_id')
        const patch = allowancePatch(req.allowance, req.updateMask?.paths ?? [])
        // Lowering below current usage is allowed; it only blocks new uploads and invites.
        const household = await updateHouseholdAllowance(
          ctx.db,
          householdId,
          patch,
        )
        if (!household) {
          throw new ConnectError('household not found', Code.NotFound)
        }
        return { household: await householdWire(ctx.db, household) }
      },
    )

    router.rpc(IamService.method.listUsers, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const query = req.query.trim() || undefined
      const { rows, nextPageToken } = await paged(
        req,
        (after, limit) => getUsers(ctx.db, { query, after, limit }),
        (u) => ({ createdAt: u.createdAt, id: u.id }),
      )
      return { users: rows.map(userToWire), nextPageToken }
    })
  },
}
