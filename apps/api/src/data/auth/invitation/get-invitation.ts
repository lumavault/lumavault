import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { invitation } from "#/db/schemas/auth.js";
import type { Invitation } from "./types.js";

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

/** How many pending, unexpired member invitations each of these households has. Households with none are left out. */
export async function countPendingInvitationsByOrganizationIds(
  db: DbOrTx,
  organizationIds: string[],
  now: Date,
): Promise<{ organizationId: string; count: number }[]> {
  return db
    .select({ organizationId: invitation.organizationId, count: count() })
    .from(invitation)
    .where(and(inArray(invitation.organizationId, organizationIds), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
    .groupBy(invitation.organizationId);
}

/** A household's pending, unexpired member invitations, oldest first. */
export async function getPendingInvitationsByOrganizationId(db: DbOrTx, organizationId: string, now: Date): Promise<Invitation[]> {
  return db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
    .orderBy(asc(invitation.createdAt), asc(invitation.id));
}

/** A member invitation by ID. Null when it does not exist. */
export async function getInvitationById(db: DbOrTx, invitationId: string): Promise<Invitation | null> {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
  return row ?? null;
}

/** A member invitation, locked until the transaction ends. Null when it does not exist. */
export async function getInvitationForUpdate(db: DbOrTx, invitationId: string): Promise<Invitation | null> {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId)).for("update");
  return row ?? null;
}
