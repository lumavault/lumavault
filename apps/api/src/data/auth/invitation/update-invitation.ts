import { and, eq, or, sql } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { invitation } from "#/db/schemas/auth.js";

export async function markInvitationAccepted(db: DbOrTx, invitationId: string): Promise<void> {
  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, invitationId));
}

/** Cancels every pending member invitation sent to this lowercased email or sent by this user. */
export async function cancelPendingInvitationsForUser(db: DbOrTx, input: { email: string; userId: string }): Promise<void> {
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(eq(invitation.status, "pending"), or(sql`lower(${invitation.email}) = ${input.email}`, eq(invitation.inviterId, input.userId))),
    );
}
