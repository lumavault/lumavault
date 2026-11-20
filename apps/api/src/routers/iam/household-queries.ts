// Household lookups shared by the IAM router files. Registers no RPCs.
import { getOrganization } from "#/data/auth/organization/get-organization.js";
import { getOwnerUserId } from "#/data/auth/member/get-member.js";
import { getHousehold } from "#/data/iam/household/get-household.js";
import type { DbOrTx } from "#/db/index.js";
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
