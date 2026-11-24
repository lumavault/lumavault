import { countPendingInvitationsByOrganizationIds } from '#/data/auth/invitation/get-invitation.js'
import {
  countMembersByOrganizationIds,
  getOwnersByOrganizationIds,
} from '#/data/auth/member/get-member.js'
import { getHouseholdPage } from '#/data/iam/household/get-household.js'
import type { PageCursor } from '#/data/sql.js'
import type { DbOrTx } from '#/db/index.js'

import type { HouseholdSummary } from './types.js'

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
