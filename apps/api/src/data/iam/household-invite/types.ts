import type { iamHouseholdInvites } from "#/db/schemas/iam.js";

/** A household invite row. */
export type HouseholdInvite = typeof iamHouseholdInvites.$inferSelect;

/** What it takes to invite someone to create a household. */
export type NewHouseholdInvite = Pick<
  typeof iamHouseholdInvites.$inferInsert,
  "tokenHash" | "email" | "storageCapBytes" | "enabledApps" | "memberLimit" | "note" | "createdBy" | "expiresAt"
>;
