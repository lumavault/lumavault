import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ContextValues } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { HOUSEHOLD_ADMIN_ROLE, HOUSEHOLD_OWNER_ROLE, type HouseholdRole } from "#/auth/constants.js";
import { invitation, member, organization, user } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import { requireHouseholdAdmin, requireHouseholdMember, requireHouseholdOwner } from "#/guards.js";
import { PORTAL_MEMBER_INVITE_PATH } from "#/iam/constants.js";
import { startGracePeriod } from "#/iam/grace.js";
import type { ApiModule, ModuleContext } from "#/modules.js";
import { requestKey } from "#/request.js";
import { assignableRoleFromWire, required, roleToWire } from "./convert.js";
import { memberInviteMessage, seatsUsed } from "./household-queries.js";
import { userMessage } from "./messages.js";

function headersOf(call: { values: ContextValues }): Headers {
  return call.values.get(requestKey)?.headers ?? new Headers();
}

/** Locks the household's iam row so seat counts and role changes see one change at a time. */
export async function withHouseholdLock<T>(ctx: ModuleContext, householdId: string, fn: (limit: number) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const [h] = await tx.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId)).for("update");
    if (!h) {
      throw new ConnectError("household has no allowance", Code.FailedPrecondition);
    }
    return fn(h.memberLimit);
  });
}

async function memberRow(ctx: ModuleContext, householdId: string, userId: string) {
  const [row] = await ctx.db.select().from(member).where(and(eq(member.organizationId, householdId), eq(member.userId, userId)));
  if (!row) {
    throw new ConnectError("no such member", Code.NotFound);
  }
  return row;
}

/**
 * Hands the Owner role to another member in one transaction; the old Owner becomes an Admin.
 * Exported for moves and leaving, where an Owner names the next Owner on the way out.
 */
export async function transferOwnership(ctx: ModuleContext, householdId: string, fromUserId: string, toUserId: string): Promise<void> {
  if (fromUserId === toUserId) {
    throw new ConnectError("you are already the Owner", Code.InvalidArgument);
  }
  await withHouseholdLock(ctx, householdId, async () => {
    await memberRow(ctx, householdId, toUserId);
    await ctx.db.transaction(async (tx) => {
      await tx.update(member).set({ role: HOUSEHOLD_ADMIN_ROLE }).where(and(eq(member.organizationId, householdId), eq(member.userId, fromUserId)));
      await tx.update(member).set({ role: HOUSEHOLD_OWNER_ROLE }).where(and(eq(member.organizationId, householdId), eq(member.userId, toUserId)));
    });
  });
}

// Household members. Every call acts on the caller's own household.
export const module: ApiModule = {
  name: "iam-households",
  rpc(router, ctx) {
    router.rpc(IamService.method.listMembers, async (_req, call) => {
      const { household } = await requireHouseholdMember(call, ctx);
      const rows = await ctx.db
        .select({ member, user })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, household.householdId))
        .orderBy(sql`${member.role} = ${HOUSEHOLD_OWNER_ROLE} desc`, asc(user.name));
      const pending = await ctx.db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, household.householdId), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date())));
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
      const role = assignableRoleFromWire(req.role);
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

    // The removed person keeps read-only access to their private data for the grace period.
    router.rpc(IamService.method.removeMember, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      await withHouseholdLock(ctx, household.householdId, async () => {
        const target = await memberRow(ctx, household.householdId, userId);
        if (target.role === HOUSEHOLD_OWNER_ROLE) {
          throw new ConnectError("the Owner cannot be removed; transfer ownership first", Code.FailedPrecondition);
        }
        await ctx.auth.api.removeMember({
          body: { memberIdOrEmail: target.id, organizationId: household.householdId },
          headers: headersOf(call),
        });
      });
      const [org] = await ctx.db.select().from(organization).where(eq(organization.id, household.householdId));
      await startGracePeriod(ctx, userId, { id: household.householdId, name: org?.name ?? "" });
      return {};
    });

    router.rpc(IamService.method.updateMemberRole, async (req, call) => {
      const { household } = await requireHouseholdAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      const role = assignableRoleFromWire(req.role);
      const target = await withHouseholdLock(ctx, household.householdId, async () => {
        const row = await memberRow(ctx, household.householdId, userId);
        if (row.role === HOUSEHOLD_OWNER_ROLE) {
          throw new ConnectError("the Owner's role changes only by transferring ownership", Code.FailedPrecondition);
        }
        await ctx.auth.api.updateMemberRole({
          body: { memberId: row.id, role, organizationId: household.householdId },
          headers: headersOf(call),
        });
        return row;
      });
      const [u] = await ctx.db.select().from(user).where(eq(user.id, userId));
      return { member: { user: userMessage(u!), role: roleToWire(role), joinedAt: timestampFromDate(target.createdAt) } };
    });

    router.rpc(IamService.method.transferOwnership, async (req, call) => {
      const { viewer, household } = await requireHouseholdOwner(call, ctx);
      await transferOwnership(ctx, household.householdId, viewer.userId, required(req.userId, "user_id"));
      return {};
    });
  },
};
