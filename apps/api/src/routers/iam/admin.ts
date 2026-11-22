import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { type Allowance, type HouseholdSchema, IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { z } from "zod";
import { cancelPendingInvitationsForUser } from "#/data/auth/invitation/update-invitation.js";
import { getOwnerUserId } from "#/data/auth/member/get-member.js";
import { getOrganizationById } from "#/data/auth/organization/get-organization.js";
import { deleteSessionsByUserId } from "#/data/auth/session/delete-session.js";
import { getUsers } from "#/data/auth/user/get-user.js";
import { banUser, unbanUser } from "#/data/auth/user/update-user.js";
import { getHouseholdSummaries } from "#/data/iam/household/get-household-summaries.js";
import type { AllowancePatch, Household } from "#/data/iam/household/types.js";
import { setHouseholdSuspended, updateHouseholdAllowance } from "#/data/iam/household/update-household.js";
import { createHouseholdInvite } from "#/data/iam/household-invite/create-household-invite.js";
import { getHouseholdInviteForUpdate, getOpenHouseholdInvites } from "#/data/iam/household-invite/get-household-invite.js";
import { revokeHouseholdInvite, revokeUnusedHouseholdInvitesByEmail } from "#/data/iam/household-invite/update-household-invite.js";
import type { PageCursor } from "#/data/sql.js";
import type { DbOrTx } from "#/db/index.js";
import { requireSuperAdmin } from "#/guards.js";
import {
  DEFAULT_MEMBER_LIMIT,
  DEFAULT_PAGE_SIZE,
  HOUSEHOLD_INVITE_PATH,
  HOUSEHOLD_INVITE_TTL_MS,
  MAX_MEMBER_LIMIT,
  MAX_PAGE_SIZE,
  MAX_STORAGE_CAP_BYTES,
} from "#/iam/constants.js";
import { hashSecret, newSecret } from "#/lib/secrets.js";
import type { ApiModule } from "#/server/modules.js";
import { appsFromWire, householdInviteToWire, householdSummaryToWire, householdToWire, required, userToWire } from "./convert.js";

const emailSchema = z.email();
const uuidSchema = z.uuid();
const cursorSchema = z.object({ c: z.iso.datetime(), i: z.string().min(1) });

// Allowance fields, by their update_mask path.

function storageCap(bytes: bigint): bigint {
  if (bytes <= 0n || bytes > MAX_STORAGE_CAP_BYTES) {
    throw new ConnectError(`storage_cap_bytes must be between 1 and ${MAX_STORAGE_CAP_BYTES}`, Code.InvalidArgument);
  }
  return bytes;
}

function enabledApps(apps: Allowance["enabledApps"]): Household["enabledApps"] {
  const parsed = appsFromWire(apps);
  if (parsed.length === 0) {
    throw new ConnectError("enabled_apps must name at least one app", Code.InvalidArgument);
  }
  return parsed;
}

function memberLimit(limit: number): number {
  if (limit < 1 || limit > MAX_MEMBER_LIMIT) {
    throw new ConnectError(`member_limit must be between 1 and ${MAX_MEMBER_LIMIT}`, Code.InvalidArgument);
  }
  return limit;
}

const ALLOWANCE_FIELDS = {
  storage_cap_bytes: (a: Allowance): AllowancePatch => ({ storageCapBytes: storageCap(a.storageCapBytes) }),
  enabled_apps: (a: Allowance): AllowancePatch => ({ enabledApps: enabledApps(a.enabledApps) }),
  member_limit: (a: Allowance): AllowancePatch => ({ memberLimit: memberLimit(a.memberLimit) }),
} as const;

/** The masked allowance fields, checked. An empty mask means every field. */
function allowancePatch(allowance: Allowance | undefined, paths: string[]): AllowancePatch {
  if (!allowance) {
    throw new ConnectError("allowance is required", Code.InvalidArgument);
  }
  const fields = paths.length > 0 ? paths : Object.keys(ALLOWANCE_FIELDS);
  let patch: AllowancePatch = {};
  for (const path of fields) {
    if (!Object.hasOwn(ALLOWANCE_FIELDS, path)) {
      throw new ConnectError(`update_mask has unknown path ${path}`, Code.InvalidArgument);
    }
    patch = { ...patch, ...ALLOWANCE_FIELDS[path as keyof typeof ALLOWANCE_FIELDS](allowance) };
  }
  return patch;
}

// Keyset paging. The token is the last row's sort key, so new rows never shift later pages.

function pageSize(requested: number): number {
  if (requested < 0) {
    throw new ConnectError("page_size must not be negative", Code.InvalidArgument);
  }
  return requested === 0 ? DEFAULT_PAGE_SIZE : Math.min(requested, MAX_PAGE_SIZE);
}

function encodePageToken(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString("base64url");
}

function decodePageToken(token: string): PageCursor | undefined {
  if (!token) {
    return undefined;
  }
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
    return { createdAt: new Date(parsed.c), id: parsed.i };
  } catch {
    throw new ConnectError("page_token is not valid", Code.InvalidArgument);
  }
}

/** Reads one extra row to learn whether another page follows. */
async function paged<T>(
  token: string,
  requestedSize: number,
  load: (after: PageCursor | undefined, limit: number) => Promise<T[]>,
  cursorOf: (row: T) => PageCursor,
): Promise<{ rows: T[]; nextPageToken: string }> {
  const size = pageSize(requestedSize);
  const rows = await load(decodePageToken(token), size + 1);
  if (rows.length <= size) {
    return { rows, nextPageToken: "" };
  }
  const kept = rows.slice(0, size);
  return { rows: kept, nextPageToken: encodePageToken(cursorOf(kept[kept.length - 1]!)) };
}

async function householdWire(db: DbOrTx, household: Household): Promise<MessageInitShape<typeof HouseholdSchema>> {
  const [org, ownerUserId] = await Promise.all([
    getOrganizationById(db, household.householdId),
    getOwnerUserId(db, household.householdId),
  ]);
  if (!org) {
    throw new ConnectError("household not found", Code.NotFound);
  }
  return householdToWire(org, household, ownerUserId ?? "");
}

// Every call here is for the server owner only. Writes go straight to Postgres in one
// transaction, as first-run setup does, so a failure partway leaves nothing behind.
export const module: ApiModule = {
  name: "iam-admin",
  rpc(router, ctx) {
    router.rpc(IamService.method.createHouseholdInvite, async (req, call) => {
      const viewer = await requireSuperAdmin(call, ctx);
      const email = required(req.email, "email").toLowerCase();
      if (!emailSchema.safeParse(email).success) {
        throw new ConnectError("email is not a valid address", Code.InvalidArgument);
      }
      if (!req.allowance) {
        throw new ConnectError("allowance is required", Code.InvalidArgument);
      }
      const allowance = {
        storageCapBytes: storageCap(req.allowance.storageCapBytes),
        enabledApps: enabledApps(req.allowance.enabledApps),
        memberLimit: req.allowance.memberLimit === 0 ? DEFAULT_MEMBER_LIMIT : memberLimit(req.allowance.memberLimit),
      };
      const token = newSecret();
      const now = new Date();

      // One open invite per email, so sending again replaces a link that went astray.
      const invite = await ctx.db.transaction(async (tx) => {
        await revokeUnusedHouseholdInvitesByEmail(tx, email, now);
        return createHouseholdInvite(tx, {
          ...allowance,
          tokenHash: hashSecret(token),
          email,
          note: req.note.trim(),
          createdBy: viewer.userId,
          expiresAt: new Date(now.getTime() + HOUSEHOLD_INVITE_TTL_MS),
        });
      });

      const inviteUrl = `${ctx.config.portalUrl.replace(/\/+$/, "")}${HOUSEHOLD_INVITE_PATH}${token}`;
      // The link is returned below either way, so a mail failure must not lose it.
      try {
        await ctx.email.sendHouseholdInvite(email, { url: inviteUrl, inviterName: viewer.name });
      } catch (err) {
        console.error("household invite created but its email failed to send", err);
      }
      return { invite: householdInviteToWire(invite), inviteUrl };
    });

    router.rpc(IamService.method.listHouseholdInvites, async (_req, call) => {
      await requireSuperAdmin(call, ctx);
      const invites = await getOpenHouseholdInvites(ctx.db, new Date());
      return { invites: invites.map(householdInviteToWire) };
    });

    router.rpc(IamService.method.revokeHouseholdInvite, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      if (!uuidSchema.safeParse(req.inviteId).success) {
        throw new ConnectError("invite_id is not a valid ID", Code.InvalidArgument);
      }
      await ctx.db.transaction(async (tx) => {
        const invite = await getHouseholdInviteForUpdate(tx, req.inviteId);
        if (!invite) {
          throw new ConnectError("invite not found", Code.NotFound);
        }
        if (invite.redeemedAt) {
          throw new ConnectError("invite was already used", Code.FailedPrecondition);
        }
        if (!invite.revokedAt) {
          await revokeHouseholdInvite(tx, invite.id, new Date());
        }
      });
      return {};
    });

    router.rpc(IamService.method.listHouseholds, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const now = new Date();
      const { rows, nextPageToken } = await paged(
        req.pageToken,
        req.pageSize,
        (after, limit) => getHouseholdSummaries(ctx.db, { after, limit, now }),
        (s) => ({ createdAt: s.organization.createdAt, id: s.organization.id }),
      );
      return { households: rows.map(householdSummaryToWire), nextPageToken };
    });

    router.rpc(IamService.method.updateHouseholdAllowance, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const householdId = required(req.householdId, "household_id");
      const patch = allowancePatch(req.allowance, req.updateMask?.paths ?? []);
      // Lowering below current usage is allowed; it only blocks new uploads and invites.
      const household = await updateHouseholdAllowance(ctx.db, householdId, patch);
      if (!household) {
        throw new ConnectError("household not found", Code.NotFound);
      }
      return { household: await householdWire(ctx.db, household) };
    });

    router.rpc(IamService.method.setHouseholdSuspended, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const householdId = required(req.householdId, "household_id");
      const household = await setHouseholdSuspended(ctx.db, householdId, req.suspended);
      if (!household) {
        throw new ConnectError("household not found", Code.NotFound);
      }
      return { household: await householdWire(ctx.db, household) };
    });

    router.rpc(IamService.method.listUsers, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const query = req.query.trim() || undefined;
      const { rows, nextPageToken } = await paged(
        req.pageToken,
        req.pageSize,
        (after, limit) => getUsers(ctx.db, { query, after, limit }),
        (u) => ({ createdAt: u.createdAt, id: u.id }),
      );
      return { users: rows.map(userToWire), nextPageToken };
    });

    router.rpc(IamService.method.banUser, async (req, call) => {
      const viewer = await requireSuperAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      if (userId === viewer.userId) {
        throw new ConnectError("you cannot ban yourself", Code.FailedPrecondition);
      }
      const banned = await ctx.db.transaction(async (tx) => {
        const u = await banUser(tx, userId, req.reason.trim());
        if (!u) {
          throw new ConnectError("user not found", Code.NotFound);
        }
        const email = u.email.toLowerCase();
        await deleteSessionsByUserId(tx, u.id);
        await revokeUnusedHouseholdInvitesByEmail(tx, email, new Date());
        await cancelPendingInvitationsForUser(tx, { email, userId: u.id });
        return u;
      });
      return { user: userToWire(banned) };
    });

    router.rpc(IamService.method.unbanUser, async (req, call) => {
      await requireSuperAdmin(call, ctx);
      const userId = required(req.userId, "user_id");
      const u = await unbanUser(ctx.db, userId);
      if (!u) {
        throw new ConnectError("user not found", Code.NotFound);
      }
      return { user: userToWire(u) };
    });
  },
};
