import { Code, ConnectError } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { signUploadTicket } from "#/auth/tickets.js";
import { requireContributorGrant, requireHouseholdMember, requireSignedIn, requireSuperAdmin } from "#/guards.js";
import type { ApiModule } from "#/modules.js";
import { APP_NAMESPACE, type Billing, cancelReservation, reserveUpload } from "#/services/quotas/index.js";
import { appFromWire } from "./convert.js";

export const module: ApiModule = {
  name: "iam-uploads",
  rpc(router, ctx) {
    router.rpc(IamService.method.prepareUpload, async (req, call) => {
      const app = appFromWire(req.app);
      if (req.sizeBytes <= 0n) {
        throw new ConnectError("size_bytes must be positive", Code.InvalidArgument);
      }

      let userId: string;
      let billing: Billing;
      switch (req.billing.case) {
        case "grantId": {
          const { viewer, grant } = await requireContributorGrant(call, ctx, req.billing.value);
          if (grant.app !== app) {
            throw new ConnectError("this grant is for another app", Code.PermissionDenied);
          }
          userId = viewer.userId;
          billing = { kind: "grant", grantId: grant.id, householdId: grant.householdId };
          break;
        }
        case "sharedLibrary": {
          userId = (await requireSuperAdmin(call, ctx)).userId;
          billing = { kind: "shared" };
          break;
        }
        default: {
          const { viewer, household } = await requireHouseholdMember(call, ctx);
          userId = viewer.userId;
          billing = { kind: "household", householdId: household.householdId };
        }
      }

      const reservation = await reserveUpload(ctx, { userId, app, sizeBytes: req.sizeBytes, billing });
      const { ticket, expiresAt } = signUploadTicket(ctx.config.ticketSecret, {
        namespace: APP_NAMESPACE[app],
        maxSizeBytes: req.sizeBytes,
      });
      return { reservationId: reservation.reservationId, uploadTicket: ticket, expiresAt: timestampFromDate(expiresAt) };
    });

    router.rpc(IamService.method.cancelUpload, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      await cancelReservation(ctx, { userId: viewer.userId, reservationId: req.reservationId });
      return {};
    });
  },
};
