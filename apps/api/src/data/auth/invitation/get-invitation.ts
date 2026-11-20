import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { invitation } from "#/db/schemas/auth.js";

/** The newest member invitation for this email that is still pending and not expired. */
export async function getPendingInvitationByEmail(db: DbOrTx, email: string, now: Date) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(and(sql`lower(${invitation.email}) = ${email}`, eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
    .orderBy(desc(invitation.createdAt))
    .limit(1);
  return row ?? null;
}

/** How many pending, unexpired member invitations each of these organizations has. */
export async function countPendingInvitationsByOrganization(db: DbOrTx, organizationIds: string[], now: Date) {
  return db
    .select({ id: invitation.organizationId, n: count() })
    .from(invitation)
    .where(and(inArray(invitation.organizationId, organizationIds), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
    .groupBy(invitation.organizationId);
}

/** Pending, unexpired invitations to one organization. */
export async function listPendingInvitations(db: DbOrTx, organizationId: string, now: Date) {
  return db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)));
}

/** How many pending, unexpired invitations one organization has. */
export async function countPendingInvitations(db: DbOrTx, organizationId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)));
  return row?.n ?? 0;
}

/** An invitation by ID, only if it belongs to this organization. */
export async function getInvitationInOrganization(db: DbOrTx, invitationId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)));
  return row ?? null;
}

/** A member invitation by ID. */
export async function getInvitation(db: DbOrTx, invitationId: string) {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
  return row ?? null;
}
