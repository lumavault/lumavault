import type { Organization } from '#/data/auth/organization.js'
import type { User } from '#/data/auth/user.js'
import type { Household } from '#/data/iam/household.js'

/** A household with its name and Owner, everything an IamService Household needs. */
export interface HouseholdView {
  organization: Organization
  household: Household
  /** Empty when the household has no Owner, which only a broken transfer could cause. */
  ownerUserId: string
}

/** One row of the Super-Admin household list. */
export interface HouseholdSummary {
  organization: Organization
  household: Household
  /** Null when the household has no Owner. */
  owner: User | null
  memberCount: number
  /** Member invites still pending and not expired. They hold seats under the member limit. */
  pendingInviteCount: number
}
