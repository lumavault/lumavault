import { Code, type ContextValues, ConnectError } from "@connectrpc/connect";
import { HOUSEHOLD_MEMBER_ROLE, HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import { requestContext, type Viewer } from "#/server/context.js";
import type { HouseholdMembership } from "#/data/iam/household/types.js";
import type { ModuleContext } from "#/server/modules.js";

/** The part of a Connect handler context the guards read. */
export interface GuardInput {
  values: ContextValues;
}

export interface HouseholdCaller {
  viewer: Viewer;
  household: HouseholdMembership;
}

/** Any signed-in user, with or without a household. */
export async function requireSignedIn(input: GuardInput, ctx: ModuleContext): Promise<Viewer> {
  const { viewer } = await requestContext(input.values, ctx);
  if (!viewer) {
    throw new ConnectError("sign in required", Code.Unauthenticated);
  }
  return viewer;
}

/** The server owner, whatever household they are in. */
export async function requireSuperAdmin(input: GuardInput, ctx: ModuleContext): Promise<Viewer> {
  const viewer = await requireSignedIn(input, ctx);
  if (!viewer.isSuperAdmin) {
    throw new ConnectError("Super-Admin only", Code.PermissionDenied);
  }
  return viewer;
}

/** Any member of a household. */
export async function requireHouseholdMember(input: GuardInput, ctx: ModuleContext): Promise<HouseholdCaller> {
  const viewer = await requireSignedIn(input, ctx);
  const { household } = await requestContext(input.values, ctx);
  if (!household) {
    throw new ConnectError("you are not in a household", Code.FailedPrecondition);
  }
  return { viewer, household };
}

/** The household's Owner or an Admin. */
export async function requireHouseholdAdmin(input: GuardInput, ctx: ModuleContext): Promise<HouseholdCaller> {
  const caller = await requireHouseholdMember(input, ctx);
  if (caller.household.role === HOUSEHOLD_MEMBER_ROLE) {
    throw new ConnectError("household Admin only", Code.PermissionDenied);
  }
  return caller;
}

/** The household's Owner. */
export async function requireHouseholdOwner(input: GuardInput, ctx: ModuleContext): Promise<HouseholdCaller> {
  const caller = await requireHouseholdMember(input, ctx);
  if (caller.household.role !== HOUSEHOLD_OWNER_ROLE) {
    throw new ConnectError("household Owner only", Code.PermissionDenied);
  }
  return caller;
}
