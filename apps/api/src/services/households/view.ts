import { getOwnerUserId } from '#/data/auth/member/get-member.js'
import { getOrganizationById } from '#/data/auth/organization/get-organization.js'
import type { Household } from '#/data/iam/household/types.js'
import type { DbOrTx } from '#/db/index.js'

import type { HouseholdView } from './types.js'

/** Adds a household's name and Owner to its row. Null when its organization is gone. */
export async function getHouseholdView(
  db: DbOrTx,
  household: Household,
): Promise<HouseholdView | null> {
  const [organization, ownerUserId] = await Promise.all([
    getOrganizationById(db, household.householdId),
    getOwnerUserId(db, household.householdId),
  ])
  return organization
    ? { organization, household, ownerUserId: ownerUserId ?? '' }
    : null
}
