import { createContextKey, type ContextValues } from '@connectrpc/connect'
import { SUPER_ADMIN_ROLE } from '#/auth/constants.js'
import { hasUserRole } from '#/auth/role-checks.js'
import { getHouseholdByUserId } from '#/data/iam/household/get-household.js'
import type { HouseholdMembership } from '#/data/iam/household/types.js'

import type { ModuleContext } from './modules.js'
import { requestKey } from './request.js'

export interface Viewer {
  userId: string
  name: string
  email: string
  isSuperAdmin: boolean
  sessionId: string
}

export interface RequestContext {
  viewer: Viewer | null
  /** Null when signed out, or when the viewer belongs to no household. */
  household: HouseholdMembership | null
}

// Each RPC resolves its context at most once, even when several guards ask for it.
const resolvedKey = createContextKey<Promise<RequestContext> | undefined>(
  undefined,
  {
    description: 'resolved request context',
  },
)

/** Who is calling, from the session cookie or bearer token on the request. */
export function requestContext(
  values: ContextValues,
  ctx: ModuleContext,
): Promise<RequestContext> {
  let resolved = values.get(resolvedKey)
  if (!resolved) {
    resolved = resolve(values, ctx)
    values.set(resolvedKey, resolved)
  }
  return resolved
}

async function resolve(
  values: ContextValues,
  ctx: ModuleContext,
): Promise<RequestContext> {
  const request = values.get(requestKey)
  if (!request) {
    return { viewer: null, household: null }
  }
  const session = await ctx.auth.api.getSession({ headers: request.headers })
  if (!session) {
    return { viewer: null, household: null }
  }
  const viewer: Viewer = {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    isSuperAdmin: hasUserRole(session.user.role, SUPER_ADMIN_ROLE),
    sessionId: session.session.id,
  }
  return {
    viewer,
    household: await getHouseholdByUserId(ctx.db, viewer.userId),
  }
}
