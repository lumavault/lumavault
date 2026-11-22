import type { HouseholdRole } from "#/auth/constants.js";
import type { Organization } from "#/data/auth/organization/types.js";
import type { User } from "#/data/auth/user/types.js";
import type { iamHouseholds } from "#/db/schemas/iam.js";

/** A household row: its allowance, usage and enabled apps. */
export type Household = typeof iamHouseholds.$inferSelect;

/** A user's one household and their role in it. */
export interface HouseholdMembership {
  householdId: string;
  role: HouseholdRole;
  suspended: boolean;
}

/** What it takes to give a new household its allowance. Usage starts at zero. */
export type NewHousehold = Pick<typeof iamHouseholds.$inferInsert, "householdId" | "storageCapBytes" | "enabledApps" | "memberLimit">;

/** One row of the Super-Admin household list. */
export interface HouseholdSummary {
  organization: Organization;
  household: Household;
  /** Null when the household has no Owner, which only a broken transfer could cause. */
  owner: User | null;
  memberCount: number;
  /** Member invites still pending and not expired. They hold seats under the member limit. */
  pendingInviteCount: number;
  /** Bytes held for people in their grace period, already part of used bytes. */
  heldBytes: bigint;
}

/** Fields of a household's allowance that the Super-Admin can change. */
export type AllowancePatch = Partial<Pick<Household, "storageCapBytes" | "enabledApps" | "memberLimit">>;
