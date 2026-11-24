import type { HouseholdRole } from '#/auth/constants.js'
import type { iamHouseholds } from '#/db/schemas/iam.js'
import type { IamApp } from '#/iam/constants.js'

/** A household row: its allowance, usage and enabled apps. */
export type Household = typeof iamHouseholds.$inferSelect

/** A user's one household, their role in it, and the apps it has turned on. */
export interface HouseholdMembership {
  householdId: string
  role: HouseholdRole
  enabledApps: IamApp[]
}

/** What it takes to give a new household its allowance. Usage starts at zero. */
export type NewHousehold = Pick<
  typeof iamHouseholds.$inferInsert,
  'householdId' | 'storageCapBytes' | 'enabledApps' | 'memberLimit'
>

/** Fields of a household's allowance that the Super-Admin can change. */
export type AllowancePatch = Partial<
  Pick<Household, 'storageCapBytes' | 'enabledApps' | 'memberLimit'>
>
