import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, eq } from "drizzle-orm";
import { requestContext } from "#/context.js";
import { member } from "#/db/schemas/auth.js";
import { requireSignedIn } from "#/guards.js";
import type { ApiModule } from "#/modules.js";
import { requestKey } from "#/request.js";
import { required } from "./convert.js";
import { buildViewer } from "./viewer-data.js";

// Viewer routes use requireSignedIn, not the household guards, so they keep working while
// the active household is suspended and people can switch away from it.
export const module: ApiModule = {
  name: "iam-viewer",
  rpc(router, ctx) {
    router.rpc(IamService.method.getViewer, async (_req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const { household } = await requestContext(call.values, ctx);
      return buildViewer(ctx.db, viewer.userId, household?.householdId ?? null);
    });

    router.rpc(IamService.method.setActiveHousehold, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const householdId = required(req.householdId, "household_id");
      const [membership] = await ctx.db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, householdId), eq(member.userId, viewer.userId)));
      if (!membership) {
        throw new ConnectError("you are not a member of that household", Code.PermissionDenied);
      }
      const request = call.values.get(requestKey);
      await ctx.auth.api.setActiveOrganization({ body: { organizationId: householdId }, headers: request?.headers ?? new Headers() });
      return { viewer: await buildViewer(ctx.db, viewer.userId, householdId) };
    });
  },
};
