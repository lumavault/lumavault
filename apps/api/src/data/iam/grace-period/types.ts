import type { iamGracePeriods } from "#/db/schemas/iam.js";

/** A user's grace period after leaving or being removed from a household. */
export type GracePeriod = typeof iamGracePeriods.$inferSelect;

export type NewGracePeriod = Pick<
  typeof iamGracePeriods.$inferInsert,
  "userId" | "householdId" | "householdName" | "heldBytes" | "startedAt" | "deleteAt"
>;
