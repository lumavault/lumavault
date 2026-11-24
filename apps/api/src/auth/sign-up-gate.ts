import { AsyncLocalStorage } from 'node:async_hooks'
import { getPendingInvitationByEmail } from '#/data/auth/invitation/get-invitation.js'
import { markInvitationAccepted } from '#/data/auth/invitation/update-invitation.js'
import { createMember } from '#/data/auth/member/create-member.js'
import { getOpenHouseholdInviteByEmail } from '#/data/iam/household-invite/get-household-invite.js'
import type { Db } from '#/db/index.js'

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
  const invite = await getPendingInvitationByEmail(db, email.toLowerCase(), now)
  if (!invite) {
    return
  }
  await db.transaction(async (tx) => {
    await createMember(tx, {
      organizationId: invite.organizationId,
      userId,
      role: invite.role ?? 'member',
      createdAt: now,
    })
    await markInvitationAccepted(tx, invite.id)
  })
}
