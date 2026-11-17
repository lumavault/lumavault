import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ContextValues } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import type { HouseholdRole } from "#/auth/constants.js";
import { invitation, member, organization, session, user } from "#/db/schemas/auth.js";
import { iamHouseholdInvites, iamHouseholds } from "#/db/schemas/iam.js";
import { requireHouseholdAdmin, requireHouseholdMember, requireSignedIn } from "#/guards.js";
import { PORTAL_MEMBER_INVITE_PATH } from "#/iam/constants.js";
import { hashSecret } from "#/iam/secrets.js";
import type { ApiModule, ModuleContext } from "#/modules.js";
import { requestKey } from "#/request.js";
import { roleFromWire, roleToWire, required } from "./convert.js";
import { clearActiveHouseholdFor, memberInviteMessage, otherAdmins, seatsUsed } from "./household-data.js";
import { householdMessage, userMessage } from "./messages.js";

type Call = { values: ContextValues };

function headersOf(call: Call): Headers {
  return call.values.get(requestKey)?.headers ?? new Headers();
}

/** Locks the household's iam row so seat counts and the last-Admin rule see one change at a time. */
async function withHouseholdLock<T>(ctx: ModuleContext, householdId: string, fn: (limit: number) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const [h] = await tx.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId)).for("update");
    if (!h) {
      throw new ConnectError("household has no allowance", Code.FailedPrecondition);
    }
    return fn(h.memberLimit);
  });
}

async function householdReply(ctx: ModuleContext, householdId: string) {
  const [org] = await ctx.db.select().from(organization).where(eq(organization.id, householdId));
  const [h] = await ctx.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId));
  if (!org) {
    throw new ConnectError("no such household", Code.NotFound);
  }
  return { household: householdMessage(org, h) };
}

export const module: ApiModule = {
  name: "iam-households",
  rpc(router, ctx) {
    router.rpc(IamService.method.redeemHouseholdInvite, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const name = required(req.householdName, "household_name");
      const tokenHash = hashSecret(required(req.token, "token"));
      const householdId = await ctx.db.transaction(async (tx) => {
        const [invite] = await tx.select().from(iamHouseholdInvites).where(eq(iamHouseholdInvites.tokenHash, tokenHash)).for("update");
        if (!invite || invite.revokedAt || invite.expiresAt <= new Date()) {
          throw new ConnectError("this invite link is not valid", Code.NotFound);
        }
        if (invite.redeemedAt) {
          throw new ConnectError("this invite link was already used", Code.FailedPrecondition);
        }
        // Better Auth creates the household on its own connection; undo it if a later step fails.
        const household = await createHouseholdFor(ctx, viewer.userId, name);
        try {
          await tx.insert(iamHouseholds).values({
            householdId: household.id,
            storageCapBytes: invite.storageCapBytes,
            enabledApps: invite.enabledApps,
            memberLimit: invite.memberLimit,
          });
          await tx
            .update(iamHouseholdInvites)
            .set({ redeemedAt: new Date(), redeemedBy: viewer.userId, householdId: household.id })
            .where(eq(iamHouseholdInvites.id, invite.id));
        } catch (err) {
          await ctx.db.delete(organization).where(eq(organization.id, household.id));
          throw err;
        }
        return household.id;
      });
      await ctx.db.update(session).set({ activeOrganizationId: householdId }).where(eq(session.id, viewer.sessionId));
      return householdReply(ctx, householdId);
    });

    router.rpc(IamService.method.listMembers, async (_req, call) => {
      const { household } = await requireHouseholdMember(call, ctx);
      const rows = await ctx.db
        .select({ member, user })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, household.householdId))
        .orderBy(asc(user.name));
      const pending = await ctx.db
        .select()
        .from(invitation)
        .where(
          and(eq(invitation.organizationId, household.householdId), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date())),
        );
      const [h] = await ctx.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, household.householdId));
      const left = (h?.memberLimit ?? 0) - rows.length - pending.length;
      return {
        members: rows.map((r) => ({
          user: userMessage(r.user),
          role: roleToWire(r.member.role as HouseholdRole),
          joinedAt: timestampFromDate(r.member.createdAt),
        })),
        pendingInvites: pending.map(memberInviteMessage),
        seatsRemaining: Math.max(left, 0),
      };
    });

    router.rpc(IamService.method.inviteMember, async (req, call) => {
      const { viewer, household } = await requireHouseholdAdmin(call, ctx);
      const email = required(req.email, "email").toLowerCase();
      const role = roleFromWire(req.role);
      const invite = await withHouseholdLock(ctx, household.householdId, async (limit) => {
        const [already] = await ctx.db
          .select({ id: member.id })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(and(eq(member.organizationId, household.householdId), sql`lower(${user.email}) = ${email}`));
        if (already) {
          throw new ConnectError("that person is already a member", Code.AlreadyExists);
        }
        if ((await seatsUsed(ctx.db, household.householdId)) >= limit) {
          throw new ConnectError("the household has no free seats; pending invites count", Code.ResourceExhausted);
        }
        return ctx.auth.api.createInvitation({
          body: { email, role, organizationId: household.householdId },
          headers: headersOf(call),
        });
      });
      const url = new URL(PORTAL_MEMBER_INVITE_PATH + invite.id, ctx.config.portalUrl).toString();
      const [org] = await ctx.db.select().from(organization).where(eq(organization.id, household.householdId));
      await ctx.email.sendMemberInvite(email, { url, householdName: org?.name ?? "a household", inviterName: viewer.name });
      return { invite: memberInviteMessage(invite as typeof invitation.$inferSelect), inviteUrl: url };
    });

    router.rpc(IamService.method.cancelMemberInvite, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx);
      const inviteId = required(req.inviteId, "invite_id");
      const [row] = await ctx.db
        .select()
        .from(invitation)
        .where(and(eq(invitation.id, inviteId), eq(invitation.organizationId, household.householdId)));
      if (!row) {
        throw new ConnectError("no such invite", Code.NotFound);
      }
      await ctx.auth.api.cancelInvitation({ body: { invitationId: inviteId }, headers: headersOf(call) });
      return {};
    });

    router.rpc(IamService.method.acceptMemberInvite, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const inviteId = required(req.inviteId, "invite_id");
      const [row] = await ctx.db.select().from(invitation).where(and(eq(invitation.id, inviteId), eq(invitation.status, "pending")));
      if (!row || row.expiresAt <= new Date()) {
        throw new ConnectError("this invite is not valid", Code.NotFound);
      }
      if (row.email.toLowerCase() !== viewer.email.toLowerCase()) {
        throw new ConnectError("this invite is for another email address", Code.PermissionDenied);
      }
      await ctx.auth.api.acceptInvitation({ body: { invitationId: inviteId }, headers: headersOf(call) });
      await ctx.db.update(session).set({ activeOrganizationId: row.organizationId }).where(eq(session.id, viewer.sessionId));
      return householdReply(ctx, row.organizationId);
    });

    router.rpc(IamService.method.removeMember, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      await withHouseholdLock(ctx, household.householdId, async () => {
        const [target] = await ctx.db
          .select()
          .from(member)
          .where(and(eq(member.organizationId, household.householdId), eq(member.userId, userId)));
        if (!target) {
          throw new ConnectError("no such member", Code.NotFound);
        }
        if ((await otherAdmins(ctx.db, household.householdId, userId)) === 0) {
          throw new ConnectError("a household needs at least one Admin", Code.FailedPrecondition);
        }
        await ctx.auth.api.removeMember({
          body: { memberIdOrEmail: target.id, organizationId: household.householdId },
          headers: headersOf(call),
        });
      });
      await clearActiveHouseholdFor(ctx.db, userId, household.householdId);
      return {};
    });

    router.rpc(IamService.method.updateMemberRole, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      const role = roleFromWire(req.role);
      const updated = await withHouseholdLock(ctx, household.householdId, async () => {
        const [target] = await ctx.db
          .select()
          .from(member)
          .where(and(eq(member.organizationId, household.householdId), eq(member.userId, userId)));
        if (!target) {
          throw new ConnectError("no such member", Code.NotFound);
        }
        if (role !== "admin" && (await otherAdmins(ctx.db, household.householdId, userId)) === 0) {
          throw new ConnectError("a household needs at least one Admin", Code.FailedPrecondition);
        }
        await ctx.auth.api.updateMemberRole({
          body: { memberId: target.id, role, organizationId: household.householdId },
          headers: headersOf(call),
        });
        return target;
      });
      const [u] = await ctx.db.select().from(user).where(eq(user.id, userId));
      return { member: { user: userMessage(u!), role: roleToWire(role), joinedAt: timestampFromDate(updated.createdAt) } };
    });
  },
};

