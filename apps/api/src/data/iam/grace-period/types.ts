import type { iamGracePeriods } from "#/db/schemas/iam.js";

/** What it takes to start a person's grace period. */
export type NewGracePeriod = typeof iamGracePeriods.$inferInsert;
