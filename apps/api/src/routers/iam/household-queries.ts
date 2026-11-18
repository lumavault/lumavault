// Household lookups shared by the IAM router files. Registers no RPCs.
import { and, eq, sum } from "drizzle-orm";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import type { Db } from "#/db/index.js";
import { member, organization } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholds } from "#/db/schemas/iam.js";
import { householdMessage } from "./messages.js";

/** The household's one Owner, or an empty string if it somehow has none. */
export async function ownerOf(db: Pick<Db, "select">, householdId: string): Promise<string> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, householdId), eq(member.role, HOUSEHOLD_OWNER_ROLE)))
    .limit(1);
  return row?.userId ?? "";
}

/** Bytes held for removed members of the household who are still in their grace period. */
export async function heldBytesOf(db: Pick<Db, "select">, householdId: string): Promise<bigint> {
  const [row] = await db.select({ total: sum(iamGracePeriods.heldBytes) }).from(iamGracePeriods).where(eq(iamGracePeriods.householdId, householdId));
  return BigInt(row?.total ?? 0);
}

/** A Household message for one household, or null if it does not exist. */
export async function loadHousehold(db: Db, householdId: string) {
  const [org] = await db.select().from(organization).where(eq(organization.id, householdId));
  if (!org) {
    return null;
  }
  const [h] = await db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId));
  return { org, allowance: h, message: householdMessage(org, h, await ownerOf(db, householdId)) };
}
