import type { iamObjectClaims } from "#/db/schemas/iam.js";

/** An object claim row: which household pays for a Gateway object. */
export type ObjectClaim = typeof iamObjectClaims.$inferSelect;

/** What it takes to bill a new object. */
export type NewObjectClaim = Pick<
  typeof iamObjectClaims.$inferInsert,
  "objectId" | "householdId" | "uploadedBy" | "reservationId" | "app" | "bytes"
>;
