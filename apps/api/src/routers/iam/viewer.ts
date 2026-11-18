import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { requireSignedIn } from "#/guards.js";
import type { ApiModule } from "#/modules.js";
import { buildViewer } from "./viewer-data.js";

// The viewer route uses requireSignedIn, not the household guards, so it keeps working while
// the household is suspended, and for people in a grace period with no household.
export const module: ApiModule = {
  name: "iam-viewer",
  rpc(router, ctx) {
    router.rpc(IamService.method.getViewer, async (_req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      return buildViewer(ctx.db, viewer.userId);
    });
  },
};
