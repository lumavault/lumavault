import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getInvitationForUpdate,
  getPendingInvitationByEmail,
  getPendingInvitationsByOrganizationId,
} from '#/data/auth/invitation/get-invitation.js'
import { markInvitationAccepted } from '#/data/auth/invitation/update-invitation.js'
import { createMember } from '#/data/auth/member/create-member.js'
import { getMembersWithUsers } from '#/data/auth/member/get-member.js'
import { getUserForUpdate } from '#/data/auth/user/get-user.js'
import { getOpenHouseholdInviteByEmail } from '#/data/iam/household-invite/get-household-invite.js'
import {
  getHouseholdByUserId,
  getHouseholdForUpdate,
} from '#/data/iam/household/get-household.js'
import type { Db } from '#/db/index.js'

import { HOUSEHOLD_MEMBER_ROLE } from './constants.js'

const serverSignUp = new AsyncLocalStorage<true>()

/** Runs fn with the sign-up gate open. Only server code, such as first-run setup, uses this. */
export function allowSignUp<T>(fn: () => Promise<T>): Promise<T> {
  return serverSignUp.run(true, fn)
}

/**
 * Why a new account may be created, or null when nothing invites this person. Every invite
 * names one email address, so sign-up is matched by email; the link's secret is only needed
 * later, to redeem a household creation invite.
 */
export async function signUpReason(
  db: Db,
  email: string,
  now: Date = new Date(),
): Promise<'server' | 'household-invite' | 'member-invite' | null> {
  if (serverSignUp.getStore()) {
    return 'server'
  }
  const lower = email.toLowerCase()
  const householdInvite = await getOpenHouseholdInviteByEmail(db, lower, now)
  if (householdInvite) {
    return 'household-invite'
  }
  return (await getPendingInvitationByEmail(db, lower, now))
    ? 'member-invite'
    : null
}

/**
 * Someone signing up from a member invite joins that household straight away, so the link
 * is all they need. With several pending invites the newest wins; the rest stay usable later.
 */
export async function joinFromMemberInvite(
  db: Db,
  userId: string,
  email: string,
  now: Date = new Date(),
): Promise<void> {
  const lower = email.toLowerCase()
  await db.transaction(async (tx) => {
    const user = await getUserForUpdate(tx, userId)
    if (!user || (await getHouseholdByUserId(tx, user.id))) {
      return
    }
    const candidate = await getPendingInvitationByEmail(tx, lower, now)
    if (!candidate) {
      return
    }
    // Lock the household before the invitation, matching inviteMember's lock order.
    const household = await getHouseholdForUpdate(tx, candidate.organizationId)
    const invite = await getInvitationForUpdate(tx, candidate.id)
    if (!invite || invite.status !== 'pending' || invite.expiresAt <= now) {
      return
    }
    if (household) {
      const members = await getMembersWithUsers(tx, household.householdId)
      // This invite already holds one of the pending seats, so only the others count against it.
      const otherInvites = (
        await getPendingInvitationsByOrganizationId(
          tx,
          household.householdId,
          now,
        )
      ).filter((i) => i.id !== invite.id)
      if (members.length + otherInvites.length >= household.memberLimit) {
        return
      }
    }
    const accepted = await markInvitationAccepted(tx, invite.id, now)
    if (!accepted) {
      return
    }
    await createMember(tx, {
      organizationId: invite.organizationId,
      userId: user.id,
      role: invite.role ?? HOUSEHOLD_MEMBER_ROLE,
      createdAt: now,
    })
  })
}
