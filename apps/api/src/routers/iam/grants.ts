import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { isUniqueViolation, noRowsOnBadUuid } from "#/db/errors.js";
import { user } from "#/db/schemas/auth.js";
import { iamContributorGrants } from "#/db/schemas/iam.js";
import { requireHouseholdAdmin, requireHouseholdMember, requireSignedIn } from "#/guards.js";
import type { ApiModule } from "#/modules.js";
import { appFromWire, appToWire, required } from "./convert.js";

type GrantRow = typeof iamContributorGrants.$inferSelect;

function grantMessage(g: GrantRow) {
  return {
    id: g.id,
    householdId: g.householdId,
    resource: { app: appToWire(g.app), kind: g.resourceKind, id: g.resourceId },
    granteeEmail: g.granteeEmail,
    granteeUserId: g.granteeUserId ?? "",
    createdAt: timestampFromDate(g.createdAt),
  };
}

// Contributor grants let someone outside a household add to one resource, billed to the
// household. Split from households.ts to keep each router file to one concern.
export const module: ApiModule = {
  name: "iam-grants",
  rpc(router, ctx) {
    router.rpc(IamService.method.createContributorGrant, async (req, call) => {
      const { viewer, household } = await requireHouseholdAdmin(call, ctx);
      const resource = req.resource;
      if (!resource) {
        throw new ConnectError("resource is required", Code.InvalidArgument);
      }
      const email = required(req.granteeEmail, "grantee_email").toLowerCase();
      const [existing] = await ctx.db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
      const [grant] = await ctx.db
        .insert(iamContributorGrants)
        .values({
          householdId: household.householdId,
          app: appFromWire(resource.app),
          resourceKind: required(resource.kind, "resource.kind"),
          resourceId: required(resource.id, "resource.id"),
          granteeEmail: email,
          granteeUserId: existing?.id ?? null,
          createdBy: viewer.userId,
        })
        .returning()
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) {
            throw new ConnectError("that person already has this grant", Code.AlreadyExists);
          }
          throw err;
        });
      // A magic link is how outside contributors sign in; the grant lets the gate create their account.
      await ctx.auth.api.signInMagicLink({ body: { email, callbackURL: ctx.config.portalUrl }, headers: new Headers() });
      return { grant: grantMessage(grant!) };
    });

    router.rpc(IamService.method.listContributorGrants, async (req, call) => {
      const filter = req.resource
        ? and(
            eq(iamContributorGrants.app, appFromWire(req.resource.app)),
            eq(iamContributorGrants.resourceKind, req.resource.kind),
            eq(iamContributorGrants.resourceId, req.resource.id),
          )
        : undefined;
      let owner;
      if (req.mine) {
        const viewer = await requireSignedIn(call, ctx);
        owner = or(eq(iamContributorGrants.granteeUserId, viewer.userId), eq(iamContributorGrants.granteeEmail, viewer.email.toLowerCase()));
      } else {
        const { household } = await requireHouseholdMember(call, ctx);
        owner = eq(iamContributorGrants.householdId, household.householdId);
      }
      const rows = await ctx.db
        .select()
        .from(iamContributorGrants)
        .where(and(owner, filter, isNull(iamContributorGrants.revokedAt)))
        .orderBy(asc(iamContributorGrants.createdAt));
      return { grants: rows.map(grantMessage) };
    });

    router.rpc(IamService.method.revokeContributorGrant, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx);
      const revoked = await ctx.db
        .update(iamContributorGrants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(iamContributorGrants.id, sql`${required(req.grantId, "grant_id")}::uuid`),
            eq(iamContributorGrants.householdId, household.householdId),
            isNull(iamContributorGrants.revokedAt),
          ),
        )
        .returning({ id: iamContributorGrants.id })
        .catch(noRowsOnBadUuid);
      if (revoked.length === 0) {
        throw new ConnectError("no such grant", Code.NotFound);
      }
      return {};
    });
  },
};
