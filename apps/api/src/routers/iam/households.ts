import { Code, ConnectError } from '@connectrpc/connect'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { HOUSEHOLD_ADMIN_ROLE, HOUSEHOLD_OWNER_ROLE } from '#/auth/constants.js'
import { createInvitation } from '#/data/auth/invitation/create-invitation.js'
import {
  getInvitationForUpdate,
  getPendingInvitationsByOrganizationId,
} from '#/data/auth/invitation/get-invitation.js'
import {
  cancelInvitation,
  cancelPendingInvitationsByEmail,
} from '#/data/auth/invitation/update-invitation.js'
import {
  getMember,
  getMembersWithUsers,
} from '#/data/auth/member/get-member.js'
import { updateMemberRole } from '#/data/auth/member/update-member.js'
import { getOrganizationById } from '#/data/auth/organization/get-organization.js'
import {
  getHouseholdById,
  getHouseholdForUpdate,
} from '#/data/iam/household/get-household.js'
import type { Household } from '#/data/iam/household/types.js'
import type { DbOrTx } from '#/db/index.js'
import {
  requireHouseholdAdmin,
  requireHouseholdMember,
  requireHouseholdOwner,
} from '#/guards.js'
import { MEMBER_INVITE_TTL_MS } from '#/iam/constants.js'
import { emailSchema } from '#/lib/validation.js'
import { MEMBER_INVITE_PATH } from '#/routes.js'
import type { ApiModule } from '#/server/modules.js'

import {
  assignableRoleFromWire,
  memberInviteToWire,
  memberToWire,
  required,
} from './convert.js'

/** The caller's household row, locked so seat counts and role changes run one at a time. */
async function lockHousehold(
  tx: DbOrTx,
  householdId: string,
): Promise<Household> {
  const household = await getHouseholdForUpdate(tx, householdId)
  if (!household) {
    throw new ConnectError('household not found', Code.NotFound)
  }
  return household
}

/** A member of this household who is not the Owner, since the Owner changes only by transfer. */
async function nonOwnerMember(tx: DbOrTx, householdId: string, userId: string) {
  const target = await getMember(tx, householdId, userId)
  if (!target) {
    throw new ConnectError('member not found', Code.NotFound)
  }
  if (target.role === HOUSEHOLD_OWNER_ROLE) {
    throw new ConnectError(
      "the Owner's role changes only by transferring ownership",
      Code.FailedPrecondition,
    )
  }
  return target
}

/** Seats left after members and pending invites. Never below zero, since a limit may be lowered. */
function seatsLeft(limit: number, members: number, invites: number): number {
  return Math.max(0, limit - members - invites)
}

// Every call acts on the caller's own household. Writes lock the household row first.
export const module: ApiModule = {
  name: 'iam-households',
  rpc(router, ctx) {
    router.rpc(IamService.method.listMembers, async (_req, call) => {
      const { household } = await requireHouseholdMember(call, ctx)
      const now = new Date()
      const [row, members, invites] = await Promise.all([
        getHouseholdById(ctx.db, household.householdId),
        getMembersWithUsers(ctx.db, household.householdId),
        getPendingInvitationsByOrganizationId(
          ctx.db,
          household.householdId,
          now,
        ),
      ])
      if (!row) {
        throw new ConnectError('household not found', Code.NotFound)
      }
      return {
        members: members.map(memberToWire),
        pendingInvites: invites.map(memberInviteToWire),
        seatsRemaining: seatsLeft(
          row.memberLimit,
          members.length,
          invites.length,
        ),
      }
    })

    router.rpc(IamService.method.inviteMember, async (req, call) => {
      const { viewer, household } = await requireHouseholdAdmin(call, ctx)
      const email = required(req.email, 'email').toLowerCase()
      if (!emailSchema.safeParse(email).success) {
        throw new ConnectError(
          'email is not a valid address',
          Code.InvalidArgument,
        )
      }
      const role = assignableRoleFromWire(req.role)
      const now = new Date()

      const { invite, householdName } = await ctx.db.transaction(async (tx) => {
        const locked = await lockHousehold(tx, household.householdId)
        const members = await getMembersWithUsers(tx, household.householdId)
        if (members.some((m) => m.user.email.toLowerCase() === email)) {
          throw new ConnectError(
            'that person is already a member',
            Code.AlreadyExists,
          )
        }
        // Inviting the same email again replaces its open invite, so it never takes a second seat.
        await cancelPendingInvitationsByEmail(tx, household.householdId, email)
        const pending = await getPendingInvitationsByOrganizationId(
          tx,
          household.householdId,
          now,
        )
        if (
          seatsLeft(locked.memberLimit, members.length, pending.length) === 0
        ) {
          throw new ConnectError(
            'the household has no free seats',
            Code.ResourceExhausted,
          )
        }
        const org = await getOrganizationById(tx, household.householdId)
        const created = await createInvitation(tx, {
          organizationId: household.householdId,
          email,
          role,
          inviterId: viewer.userId,
          expiresAt: new Date(now.getTime() + MEMBER_INVITE_TTL_MS),
        })
        return { invite: created, householdName: org?.name ?? '' }
      })

      const inviteUrl = `${ctx.config.portalUrl}${MEMBER_INVITE_PATH}${invite.id}`
      // The link is returned below either way, so a mail failure must not lose it.
      try {
        await ctx.email.sendMemberInvite(email, {
          url: inviteUrl,
          householdName,
          inviterName: viewer.name,
        })
      } catch (err) {
        console.error('member invite created but its email failed to send', err)
      }
      return { invite: memberInviteToWire(invite), inviteUrl }
    })

    router.rpc(IamService.method.cancelMemberInvite, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx)
      const inviteId = required(req.inviteId, 'invite_id')
      await ctx.db.transaction(async (tx) => {
        const invite = await getInvitationForUpdate(tx, inviteId)
        if (!invite || invite.organizationId !== household.householdId) {
          throw new ConnectError('invite not found', Code.NotFound)
        }
        if (invite.status === 'accepted') {
          throw new ConnectError(
            'invite was already used',
            Code.FailedPrecondition,
          )
        }
        if (invite.status === 'pending') {
          await cancelInvitation(tx, invite.id)
        }
      })
      return {}
    })

    router.rpc(IamService.method.updateMemberRole, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx)
      const userId = required(req.userId, 'user_id')
      const role = assignableRoleFromWire(req.role)
      const updated = await ctx.db.transaction(async (tx) => {
        await lockHousehold(tx, household.householdId)
        await nonOwnerMember(tx, household.householdId, userId)
        await updateMemberRole(tx, household.householdId, userId, role)
        const members = await getMembersWithUsers(tx, household.householdId)
        return members.find((m) => m.user.id === userId)
      })
      if (!updated) {
        throw new ConnectError('member not found', Code.NotFound)
      }
      return { member: memberToWire(updated) }
    })

    router.rpc(IamService.method.transferOwnership, async (req, call) => {
      const { viewer, household } = await requireHouseholdOwner(call, ctx)
      const userId = required(req.userId, 'user_id')
      if (userId === viewer.userId) {
        throw new ConnectError(
          'you already own this household',
          Code.FailedPrecondition,
        )
      }
      await ctx.db.transaction(async (tx) => {
        await lockHousehold(tx, household.householdId)
        // Checked again under the lock, in case another transfer just finished.
        const caller = await getMember(tx, household.householdId, viewer.userId)
        if (caller?.role !== HOUSEHOLD_OWNER_ROLE) {
          throw new ConnectError('household Owner only', Code.PermissionDenied)
        }
        if (!(await getMember(tx, household.householdId, userId))) {
          throw new ConnectError('member not found', Code.NotFound)
        }
        await updateMemberRole(
          tx,
          household.householdId,
          viewer.userId,
          HOUSEHOLD_ADMIN_ROLE,
        )
        await updateMemberRole(
          tx,
          household.householdId,
          userId,
          HOUSEHOLD_OWNER_ROLE,
        )
      })
      return {}
    })
  },
}
