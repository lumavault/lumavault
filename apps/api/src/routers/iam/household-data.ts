// Household queries shared by the household and grant router files. Registers no RPCs.
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { and, count, eq, gt, ne } from "drizzle-orm";
import { HOUSEHOLD_ADMIN_ROLE, type HouseholdRole } from "#/auth/constants.js";
import type { Db } from "#/db/index.js";
import { invitation, member, session } from "#/db/schemas/auth.js";
import { roleToWire } from "./convert.js";

type InvitationRow = typeof invitation.$inferSelect;

export function memberInviteMessage(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: roleToWire(row.role as HouseholdRole),
    expiresAt: timestampFromDate(row.expiresAt),
  };
}

/** Members plus unexpired pending invites: the seats a household is using. */
export async function seatsUsed(db: Pick<Db, "select">, householdId: string): Promise<number> {
  const [members] = await db.select({ n: count() }).from(member).where(eq(member.organizationId, householdId));
  const [pending] = await db
    .select({ n: count() })
    .from(invitation)
    .where(and(eq(invitation.organizationId, householdId), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date())));
  return (members?.n ?? 0) + (pending?.n ?? 0);
}

/** How many Admins the household would have left without this user. */
export async function otherAdmins(db: Pick<Db, "select">, householdId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, householdId), eq(member.role, HOUSEHOLD_ADMIN_ROLE), ne(member.userId, userId)));
  return row?.n ?? 0;
}

/** Points every session of userId that is in householdId at no household. */
export async function clearActiveHouseholdFor(db: Db, userId: string, householdId: string): Promise<void> {
  await db
    .update(session)
    .set({ activeOrganizationId: null })
    .where(and(eq(session.userId, userId), eq(session.activeOrganizationId, householdId)));
}
