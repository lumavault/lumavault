// Household lookups shared by the IAM router files. Registers no RPCs.
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { HouseholdRole } from "#/auth/constants.js";
import { countPendingInvitations } from "#/data/auth/invitation/get-invitation.js";
import { countMembers, getOwnerUserId } from "#/data/auth/member/get-member.js";
import { getOrganization } from "#/data/auth/organization/get-organization.js";
import { getHousehold } from "#/data/iam/household/get-household.js";
import type { DbOrTx } from "#/db/index.js";
import type { invitation } from "#/db/schemas/auth.js";
import { roleToWire } from "./convert.js";
import { householdMessage } from "./messages.js";

/** A Household message for one household, or null if it does not exist. */
export async function loadHousehold(db: DbOrTx, householdId: string) {
  const org = await getOrganization(db, householdId);
  if (!org) {
    return null;
  }
  const allowance = (await getHousehold(db, householdId)) ?? undefined;
  const ownerUserId = (await getOwnerUserId(db, householdId)) ?? "";
  return { org, allowance, message: householdMessage(org, allowance, ownerUserId) };
}

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
export async function seatsUsed(db: DbOrTx, householdId: string): Promise<number> {
  return (await countMembers(db, householdId)) + (await countPendingInvitations(db, householdId, new Date()));
}
