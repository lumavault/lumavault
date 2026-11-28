// Read models that combine several household queries for IamService.
import { countPendingInvitationsByOrganizationIds } from '#/data/auth/invitation/get-invitation.js'
import {
  countMembersByOrganizationIds,
  getOwnersByOrganizationIds,
  getOwnerUserId,
} from '#/data/auth/member/get-member.js'
import { getOrganizationById } from '#/data/auth/organization/get-organization.js'
import type { Organization } from '#/data/auth/organization/types.js'
import type { User } from '#/data/auth/user/types.js'
import { getHouseholdPage } from '#/data/iam/household/get-household.js'
import type { Household } from '#/data/iam/household/types.js'
import type { PageCursor } from '#/data/sql.js'
import type { DbOrTx } from '#/db/index.js'

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

/**
 * A page of households in creation order with their Owner, member count, pending member
 * invites. Each fact is one query for the whole page, not one per household.
 */
export async function getHouseholdSummaries(
  db: DbOrTx,
  page: { after?: PageCursor; limit: number; now: Date },
): Promise<HouseholdSummary[]> {
  const rows = await getHouseholdPage(db, page)
  if (rows.length === 0) {
    return []
  }
  const ids = rows.map((r) => r.organization.id)
  const [owners, members, invites] = await Promise.all([
    getOwnersByOrganizationIds(db, ids),
    countMembersByOrganizationIds(db, ids),
    countPendingInvitationsByOrganizationIds(db, ids, page.now),
  ])

  const ownerBy = new Map(owners.map((o) => [o.organizationId, o.user]))
  const membersBy = new Map(members.map((m) => [m.organizationId, m.count]))
  const invitesBy = new Map(invites.map((i) => [i.organizationId, i.count]))
  return rows.map(({ organization, household }) => ({
    organization,
    household,
    owner: ownerBy.get(organization.id) ?? null,
    memberCount: membersBy.get(organization.id) ?? 0,
    pendingInviteCount: invitesBy.get(organization.id) ?? 0,
  }))
}
