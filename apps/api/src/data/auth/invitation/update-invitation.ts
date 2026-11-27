import type { DbOrTx } from '#/db/index.js'
import { invitation } from '#/db/schemas/auth.js'
import { and, eq, gt, sql } from 'drizzle-orm'

import type { Invitation } from './types.js'

/**
 * Marks a pending, unexpired member invitation accepted and returns it. Null when it was
 * already used, canceled, or expired.
 */
export async function markInvitationAccepted(
  db: DbOrTx,
  invitationId: string,
  now: Date,
): Promise<Invitation | null> {
  const [row] = await db
    .update(invitation)
    .set({ status: 'accepted' })
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
      ),
    )
    .returning()
  return row ?? null
}

export async function cancelInvitation(
  db: DbOrTx,
  invitationId: string,
): Promise<void> {
  await db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(eq(invitation.id, invitationId))
}

/** Cancels this household's pending member invitations to this lowercased email. */
export async function cancelPendingInvitationsByEmail(
  db: DbOrTx,
  organizationId: string,
  email: string,
): Promise<void> {
  await db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.status, 'pending'),
        sql`lower(${invitation.email}) = ${email}`,
      ),
    )
}

/** Cancels every pending member invitation to this lowercased email, in any household. */
export async function cancelAllPendingInvitationsByEmail(
  db: DbOrTx,
  email: string,
): Promise<void> {
  await db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.status, 'pending'),
        sql`lower(${invitation.email}) = ${email}`,
      ),
    )
}
