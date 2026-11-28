import { Code, ConnectError } from '@connectrpc/connect'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { getOwnerUserId } from '#/data/auth/member.js'
import { getOrganizationById } from '#/data/auth/organization.js'
import { getUserById } from '#/data/auth/user.js'
import { getHouseholdById, getHouseholdByUserId } from '#/data/iam/household.js'
import { requireSignedIn } from '#/guards.js'
import type { ApiModule } from '#/server/modules.js'

import {
  householdToWire,
  roleToWire,
  usageToWire,
  userToWire,
} from './convert.js'

// GetViewer uses requireSignedIn, not the household guards, so it keeps working for people
// with no household yet.
export const module: ApiModule = {
  name: 'iam-viewer',
  rpc(router, ctx) {
    router.rpc(IamService.method.getViewer, async (_req, call) => {
      const viewer = await requireSignedIn(call, ctx)
      const u = await getUserById(ctx.db, viewer.userId)
      if (!u) {
        throw new ConnectError('sign in required', Code.Unauthenticated)
      }
      const result = { user: userToWire(u) }

      const membership = await getHouseholdByUserId(ctx.db, u.id)
      if (!membership) {
        return result
      }
      const [org, household, ownerUserId] = await Promise.all([
        getOrganizationById(ctx.db, membership.householdId),
        getHouseholdById(ctx.db, membership.householdId),
        getOwnerUserId(ctx.db, membership.householdId),
      ])
      if (!org || !household) {
        return result
      }
      return {
        ...result,
        household: householdToWire(org, household, ownerUserId ?? ''),
        role: roleToWire(membership.role),
        usage: usageToWire(household),
      }
    })
  },
}
