import type { iamHouseholdInvites } from '#/db/schemas/iam.js'

/** A household creation invite row. */
export type HouseholdInvite = typeof iamHouseholdInvites.$inferSelect

/** What it takes to issue a household creation invite. */
export type NewHouseholdInvite = Pick<
  typeof iamHouseholdInvites.$inferInsert,
  | 'tokenHash'
  | 'email'
  | 'storageCapBytes'
  | 'enabledApps'
  | 'memberLimit'
  | 'note'
  | 'createdBy'
  | 'expiresAt'
>
