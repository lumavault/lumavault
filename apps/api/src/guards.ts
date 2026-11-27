import { Code, ConnectError, type ContextValues } from '@connectrpc/connect'
import {
  HOUSEHOLD_MEMBER_ROLE,
  HOUSEHOLD_OWNER_ROLE,
} from '#/auth/constants.js'
import type { HouseholdMembership } from '#/data/iam/household.js'
import type { IamApp } from '#/iam/constants.js'
import { requestContext, type Viewer } from '#/server/context.js'
import type { ModuleContext } from '#/server/modules.js'

/** The part of a Connect handler context the guards read. */
export interface GuardInput {
  values: ContextValues
}

export interface HouseholdCaller {
  viewer: Viewer
  household: HouseholdMembership
}

/** Any signed-in user, with or without a household. */
export async function requireSignedIn(
  input: GuardInput,
  ctx: ModuleContext,
): Promise<Viewer> {
  const { viewer } = await requestContext(input.values, ctx)
  if (!viewer) {
    throw new ConnectError('sign in required', Code.Unauthenticated)
  }
  return viewer
}

/** The server owner, whatever household they are in. */
export async function requireSuperAdmin(
  input: GuardInput,
  ctx: ModuleContext,
): Promise<Viewer> {
  const viewer = await requireSignedIn(input, ctx)
  if (!viewer.isSuperAdmin) {
    throw new ConnectError('Super-Admin only', Code.PermissionDenied)
  }
  return viewer
}

/** Any member of a household. */
export async function requireHouseholdMember(
  input: GuardInput,
  ctx: ModuleContext,
): Promise<HouseholdCaller> {
  const viewer = await requireSignedIn(input, ctx)
  const { household } = await requestContext(input.values, ctx)
  if (!household) {
    throw new ConnectError(
      'you are not in a household',
      Code.FailedPrecondition,
    )
  }
  return { viewer, household }
}

export interface AppCaller {
  viewer: Viewer
  /** Null only for a Super-Admin let in without a household that has the app on. */
  household: HouseholdMembership | null
}

export interface RequireAppOptions {
  /** Let a Super-Admin in with no household, or one without the app. */
  allowSuperAdminWithoutHousehold?: boolean
}

/** A member of a household that has this app turned on. */
export async function requireApp(
  input: GuardInput,
  ctx: ModuleContext,
  app: IamApp,
): Promise<HouseholdCaller>
export async function requireApp(
  input: GuardInput,
  ctx: ModuleContext,
  app: IamApp,
  options: RequireAppOptions & { allowSuperAdminWithoutHousehold: true },
): Promise<AppCaller>
export async function requireApp(
  input: GuardInput,
  ctx: ModuleContext,
  app: IamApp,
  options?: RequireAppOptions,
): Promise<HouseholdCaller | AppCaller>
export async function requireApp(
  input: GuardInput,
  ctx: ModuleContext,
  app: IamApp,
  options: RequireAppOptions = {},
): Promise<HouseholdCaller | AppCaller> {
  if (options.allowSuperAdminWithoutHousehold) {
    const viewer = await requireSignedIn(input, ctx)
    const { household } = await requestContext(input.values, ctx)
    if (viewer.isSuperAdmin && !hasApp(household, app)) {
      return { viewer, household: null }
    }
  }
  const caller = await requireHouseholdMember(input, ctx)
  if (!caller.household.enabledApps.includes(app)) {
    throw new ConnectError(
      `${app} is not enabled for this household`,
      Code.PermissionDenied,
    )
  }
  return caller
}

function hasApp(household: HouseholdMembership | null, app: IamApp): boolean {
  return household !== null && household.enabledApps.includes(app)
}

/** The household's Owner or an Admin. */
export async function requireHouseholdAdmin(
  input: GuardInput,
  ctx: ModuleContext,
): Promise<HouseholdCaller> {
  const caller = await requireHouseholdMember(input, ctx)
  if (caller.household.role === HOUSEHOLD_MEMBER_ROLE) {
    throw new ConnectError('household Admin only', Code.PermissionDenied)
  }
  return caller
}

/** The household's Owner. */
export async function requireHouseholdOwner(
  input: GuardInput,
  ctx: ModuleContext,
): Promise<HouseholdCaller> {
  const caller = await requireHouseholdMember(input, ctx)
  if (caller.household.role !== HOUSEHOLD_OWNER_ROLE) {
    throw new ConnectError('household Owner only', Code.PermissionDenied)
  }
  return caller
}
