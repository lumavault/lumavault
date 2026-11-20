import type { HouseholdRole } from "#/auth/constants.js";
import type { iamHouseholds } from "#/db/schemas/iam.js";

/** A household row: its allowance, usage and enabled apps. */
export type Household = typeof iamHouseholds.$inferSelect;

/** A user's one household and their role in it. */
export interface HouseholdMembership {
  householdId: string;
  role: HouseholdRole;
  suspended: boolean;
}
