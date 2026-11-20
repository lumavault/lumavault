import type { HouseholdRole } from "#/auth/constants.js";
import type { iamHouseholds } from "#/db/schemas/iam.js";

/** A household row: its allowance, usage and enabled apps. */
export type Household = typeof iamHouseholds.$inferSelect;

/** What it takes to give a new household its allowance. */
export type NewHousehold = Pick<typeof iamHouseholds.$inferInsert, "householdId" | "storageCapBytes" | "enabledApps" | "memberLimit">;

/** The allowance fields a Super-Admin can change. */
export type AllowanceChanges = Partial<Pick<typeof iamHouseholds.$inferInsert, "storageCapBytes" | "enabledApps" | "memberLimit">>;

/** A user's one household and their role in it. */
export interface HouseholdMembership {
  householdId: string;
  role: HouseholdRole;
  suspended: boolean;
}
