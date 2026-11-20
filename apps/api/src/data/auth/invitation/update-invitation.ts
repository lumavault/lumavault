import { and, eq, or, sql } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { invitation } from "#/db/schemas/auth.js";

export async function markInvitationAccepted(db: DbOrTx, invitationId: string): Promise<void> {
  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, invitationId));
}

/** Cancels the pending invitations a user sent or received, so a banned user cannot rejoin through one. */
export async function cancelPendingInvitationsOf(db: DbOrTx, input: { userId: string; email: string }): Promise<void> {
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.status, "pending"),
        or(eq(invitation.inviterId, input.userId), sql`lower(${invitation.email}) = ${input.email.toLowerCase()}`),
      ),
    );
}
