import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, asc, count, eq, gt, ilike, inArray, isNull, or, sql, sum } from "drizzle-orm";
import { noRowsOnBadUuid } from "#/db/errors.js";
import { invitation, member, organization, user } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholdInvites, iamHouseholds } from "#/db/schemas/iam.js";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import { requireSuperAdmin } from "#/guards.js";
import {
  DEFAULT_MEMBER_LIMIT,
  HOUSEHOLD_INVITE_TTL_MS,
  PORTAL_HOUSEHOLD_INVITE_PATH,
} from "#/iam/constants.js";
import { hashSecret, newSecret } from "#/iam/secrets.js";
import type { ApiModule } from "#/modules.js";
import { requestKey } from "#/request.js";
import { appsFromWire, appToWire, required } from "./convert.js";
import { loadHousehold } from "./household-queries.js";
import { householdMessage, usageMessage, userMessage } from "./messages.js";
import { decodePageToken, encodePageToken, pageSize } from "./paging.js";

const ALLOWANCE_PATHS = ["storage_cap_bytes", "enabled_apps", "member_limit"] as const;

type InviteRow = typeof iamHouseholdInvites.$inferSelect;

function inviteMessage(row: InviteRow) {
  return {
    id: row.id,
    email: row.email,
    note: row.note,
    allowance: { storageCapBytes: row.storageCapBytes, enabledApps: row.enabledApps.map(appToWire), memberLimit: row.memberLimit },
    expiresAt: timestampFromDate(row.expiresAt),
    createdAt: timestampFromDate(row.createdAt),
  };
}

function memberLimit(requested: number): number {
  return requested > 0 ? requested : DEFAULT_MEMBER_LIMIT;
}

// Every RPC here is Super-Admin only and stays reachable even if their own household is suspended.
export const module: ApiModule = {
  name: "iam-admin",
  rpc(router, ctx) {
    router.rpc(IamService.method.createHouseholdInvite, async (req, call) => {
      const admin = await requireSuperAdmin(call, ctx);
      const allowance = req.allowance;
      const email = required(req.email, "email").toLowerCase();
      const token = newSecret();
      const [row] = await ctx.db
        .insert(iamHouseholdInvites)
        .values({
          tokenHash: hashSecret(token),
          email,
          storageCapBytes: allowance?.storageCapBytes ?? 0n,
          enabledApps: appsFromWire(allowance?.enabledApps ?? []),
          memberLimit: memberLimit(allowance?.memberLimit ?? 0),
          note: req.note.trim(),
          createdBy: admin.userId,
          expiresAt: new Date(Date.now() + HOUSEHOLD_INVITE_TTL_MS),
        })
        .returning();
      const url = new URL(PORTAL_HOUSEHOLD_INVITE_PATH + token, ctx.config.portalUrl).toString();
      await ctx.email.sendHouseholdInvite(email, { url, inviterName: admin.name });
      return { invite: inviteMessage(row!), inviteUrl: url };
    });

    router.rpc(IamService.method.listHouseholdInvites, async (_req, call) => {
      await requireSuperAdmin(call, ctx);
      const rows = await ctx.db
        .select()
        .from(iamHouseholdInvites)
        .where(
          and(
            isNull(iamHouseholdInvites.redeemedAt),
            isNull(iamHouseholdInvites.revokedAt),
            gt(iamHouseholdInvites.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(iamHouseholdInvites.createdAt));
      return { invites: rows.map(inviteMessage) };
    });

    router.rpc(IamService.method.revokeHouseholdInvite, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const updated = await ctx.db
        .update(iamHouseholdInvites)
        .set({ revokedAt: new Date() })
        .where(and(eq(iamHouseholdInvites.id, sql`${required(req.inviteId, "invite_id")}::uuid`), isNull(iamHouseholdInvites.redeemedAt)))
        .returning({ id: iamHouseholdInvites.id })
        .catch(noRowsOnBadUuid);
      if (updated.length === 0) {
        throw new ConnectError("no such open invite", Code.NotFound);
      }
      return {};
    });

    router.rpc(IamService.method.listHouseholds, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const limit = pageSize(req.pageSize);
      const after = decodePageToken(req.pageToken);
      const rows = await ctx.db
        .select({ org: organization, household: iamHouseholds })
        .from(organization)
        .leftJoin(iamHouseholds, eq(iamHouseholds.householdId, organization.id))
        .where(after ? gt(organization.id, after) : undefined)
        .orderBy(asc(organization.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const ids = page.map((r) => r.org.id);
      const memberCounts = ids.length
        ? await ctx.db.select({ id: member.organizationId, n: count() }).from(member).where(inArray(member.organizationId, ids)).groupBy(member.organizationId)
        : [];
      const inviteCounts = ids.length
        ? await ctx.db
            .select({ id: invitation.organizationId, n: count() })
            .from(invitation)
            .where(and(inArray(invitation.organizationId, ids), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date())))
            .groupBy(invitation.organizationId)
        : [];
      const members = new Map(memberCounts.map((c) => [c.id, c.n]));
      const ownerRows = ids.length
        ? await ctx.db
            .select({ householdId: member.organizationId, user })
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .where(and(inArray(member.organizationId, ids), eq(member.role, HOUSEHOLD_OWNER_ROLE)))
        : [];
      const owners = new Map(ownerRows.map((o) => [o.householdId, o.user]));
      const heldRows = ids.length
        ? await ctx.db
            .select({ id: iamGracePeriods.householdId, total: sum(iamGracePeriods.heldBytes) })
            .from(iamGracePeriods)
            .where(inArray(iamGracePeriods.householdId, ids))
            .groupBy(iamGracePeriods.householdId)
        : [];
      const held = new Map(heldRows.map((h) => [h.id, BigInt(h.total ?? 0)]));
      const invites = new Map(inviteCounts.map((c) => [c.id, c.n]));
      return {
        households: page.map((r) => ({
          household: householdMessage(r.org, r.household ?? undefined, owners.get(r.org.id)?.id ?? ""),
          owner: owners.has(r.org.id) ? userMessage(owners.get(r.org.id)!) : undefined,
          usage: usageMessage(r.household ?? undefined, held.get(r.org.id) ?? 0n),
          memberCount: members.get(r.org.id) ?? 0,
          pendingInviteCount: invites.get(r.org.id) ?? 0,
        })),
        nextPageToken: rows.length > limit ? encodePageToken(page.at(-1)!.org.id) : "",
      };
    });

    router.rpc(IamService.method.updateHouseholdAllowance, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const householdId = required(req.householdId, "household_id");
      const paths = req.updateMask?.paths ?? [];
      if (paths.length === 0) {
        throw new ConnectError("update_mask is empty", Code.InvalidArgument);
      }
      const set: Partial<typeof iamHouseholds.$inferInsert> = {};
      for (const path of paths) {
        if (!(ALLOWANCE_PATHS as readonly string[]).includes(path)) {
          throw new ConnectError(`cannot update ${path}`, Code.InvalidArgument);
        }
        if (path === "storage_cap_bytes") set.storageCapBytes = req.allowance?.storageCapBytes ?? 0n;
        if (path === "enabled_apps") set.enabledApps = appsFromWire(req.allowance?.enabledApps ?? []);
        if (path === "member_limit") {
          const limit = req.allowance?.memberLimit ?? 0;
          if (limit < 1) throw new ConnectError("member_limit must be at least 1", Code.InvalidArgument);
          set.memberLimit = limit;
        }
      }
      // A cap or limit below current usage is allowed; it only blocks new uploads and invites.
      await ctx.db.update(iamHouseholds).set(set).where(eq(iamHouseholds.householdId, householdId));
      const household = await loadHousehold(ctx.db, householdId);
      if (!household?.allowance) {
        throw new ConnectError("no such household", Code.NotFound);
      }
      return { household: household.message };
    });

    router.rpc(IamService.method.setHouseholdSuspended, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const householdId = required(req.householdId, "household_id");
      await ctx.db.update(iamHouseholds).set({ suspended: req.suspended }).where(eq(iamHouseholds.householdId, householdId));
      const household = await loadHousehold(ctx.db, householdId);
      if (!household?.allowance) {
        throw new ConnectError("no such household", Code.NotFound);
      }
      return { household: household.message };
    });

    router.rpc(IamService.method.listUsers, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const limit = pageSize(req.pageSize);
      const after = decodePageToken(req.pageToken);
      const q = req.query.trim();
      const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await ctx.db
        .select()
        .from(user)
        .where(and(q ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined, after ? gt(user.id, after) : undefined))
        .orderBy(asc(user.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return {
        users: page.map(userMessage),
        nextPageToken: rows.length > limit ? encodePageToken(page.at(-1)!.id) : "",
      };
    });

    router.rpc(IamService.method.banUser, async (req, call) => {
      const admin = await requireSuperAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      if (userId === admin.userId) {
        throw new ConnectError("you cannot ban yourself", Code.FailedPrecondition);
      }
      const [target] = await ctx.db.select().from(user).where(eq(user.id, userId));
      if (!target) {
        throw new ConnectError("no such user", Code.NotFound);
      }
      // Better Auth's admin plugin marks the ban and revokes every session in one step.
      await ctx.auth.api.banUser({
        body: { userId, banReason: req.reason.trim() || undefined },
        headers: call.values.get(requestKey)?.headers ?? new Headers(),
      });
      // Pending invites to or from the user die with the ban, so they cannot rejoin through one.
      await ctx.db
        .update(invitation)
        .set({ status: "canceled" })
        .where(and(eq(invitation.status, "pending"), or(eq(invitation.inviterId, userId), sql`lower(${invitation.email}) = ${target.email.toLowerCase()}`)));
      const [updated] = await ctx.db.select().from(user).where(eq(user.id, userId));
      return { user: userMessage(updated!) };
    });

    router.rpc(IamService.method.unbanUser, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      await ctx.auth.api.unbanUser({ body: { userId }, headers: call.values.get(requestKey)?.headers ?? new Headers() });
      const [updated] = await ctx.db.select().from(user).where(eq(user.id, userId));
      if (!updated) {
        throw new ConnectError("no such user", Code.NotFound);
      }
      return { user: userMessage(updated) };
    });
  },
};
