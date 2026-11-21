import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { getOwnerUserId } from "#/data/auth/member/get-member.js";
import { getOrganizationById } from "#/data/auth/organization/get-organization.js";
import { getUserById } from "#/data/auth/user/get-user.js";
import { getGracePeriodByUserId, getHeldBytesByHousehold } from "#/data/iam/grace-period/get-grace-period.js";
import { getHouseholdById, getHouseholdByUserId } from "#/data/iam/household/get-household.js";
import { requireSignedIn } from "#/guards.js";
import type { ApiModule } from "#/server/modules.js";
import { gracePeriodToWire, householdToWire, roleToWire, usageToWire, userToWire } from "./convert.js";

// GetViewer uses requireSignedIn, not the household guards, so it keeps working while the
// household is suspended and for people in a grace period with no household.
export const module: ApiModule = {
  name: "iam-viewer",
  rpc(router, ctx) {
    router.rpc(IamService.method.getViewer, async (_req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const u = await getUserById(ctx.db, viewer.userId);
      if (!u) {
        throw new ConnectError("sign in required", Code.Unauthenticated);
      }
      const grace = await getGracePeriodByUserId(ctx.db, u.id);
      const result = { user: userToWire(u), gracePeriod: grace ? gracePeriodToWire(grace) : undefined };

      const membership = await getHouseholdByUserId(ctx.db, u.id);
      if (!membership) {
        return result;
      }
      const [org, household, ownerUserId, heldBytes] = await Promise.all([
        getOrganizationById(ctx.db, membership.householdId),
        getHouseholdById(ctx.db, membership.householdId),
        getOwnerUserId(ctx.db, membership.householdId),
        getHeldBytesByHousehold(ctx.db, membership.householdId),
      ]);
      if (!org || !household) {
        return result;
      }
      return {
        ...result,
        household: householdToWire(org, household, ownerUserId ?? ""),
        role: roleToWire(membership.role),
        usage: usageToWire(household, heldBytes),
      };
    });
  },
};
