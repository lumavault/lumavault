import { Code, ConnectError } from '@connectrpc/connect'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { getUserById } from '#/data/auth/user/get-user.js'
import { getHouseholdById } from '#/data/iam/household/get-household.js'
import { requireSignedIn } from '#/guards.js'
import { requestContext } from '#/server/context.js'
import type { ApiModule } from '#/server/modules.js'
import { getHouseholdView } from '#/services/households.js'

import {
  householdViewToWire,
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
      const { household: membership } = await requestContext(call.values, ctx)
      const [u, household] = await Promise.all([
        getUserById(ctx.db, viewer.userId),
        membership ? getHouseholdById(ctx.db, membership.householdId) : null,
      ])
      if (!u) {
        throw new ConnectError('sign in required', Code.Unauthenticated)
      }
      const result = { user: userToWire(u) }
      if (!membership || !household) {
        return result
      }
      const view = await getHouseholdView(ctx.db, household)
      if (!view) {
        return result
      }
      return {
        ...result,
        household: householdViewToWire(view),
        role: roleToWire(membership.role),
        usage: usageToWire(household),
      }
    })
  },
}
