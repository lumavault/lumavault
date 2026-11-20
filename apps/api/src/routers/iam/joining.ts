import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamService, InviteKind, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { HOUSEHOLD_OWNER_ROLE, type HouseholdRole } from "#/auth/constants.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { requestContext, type Viewer } from "#/context.js";
import { markInvitationAccepted } from "#/data/auth/invitation/update-invitation.js";
import { deleteMember } from "#/data/auth/member/delete-member.js";
import { createMember } from "#/data/auth/member/create-member.js";
import { listOtherMembersWithUsers } from "#/data/auth/member/get-member.js";
import { getOrganization } from "#/data/auth/organization/get-organization.js";
import { getUserById } from "#/data/auth/user/get-user.js";
import { getGracePeriodByUserId } from "#/data/iam/grace-period/get-grace-period.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { getHousehold, getHouseholdByUserId } from "#/data/iam/household/get-household.js";
import type { HouseholdMembership } from "#/data/iam/household/types.js";
import { markHouseholdInviteRedeemed } from "#/data/iam/household-invite/update-household-invite.js";
import { requireHouseholdMember, requireSignedIn } from "#/guards.js";
import { billedBytes, privateObjectsOf, startGracePeriod } from "#/iam/grace.js";
import { type ResolvedInvite, resolveInvite } from "#/iam/invites.js";
import { type ChosenItem, closeHousehold, copySharedItems, movePrivateData, pickItems, sharedItemsOf } from "#/iam/moves.js";
import type { ApiModule, ModuleContext } from "#/modules.js";
import { appFromWire, appToWire, required, roleToWire } from "./convert.js";
import { loadHousehold } from "./household-queries.js";
import { transferOwnership, withHouseholdLock } from "./households.js";
import { userMessage } from "./messages.js";
import { decodePageToken, encodePageToken, pageSize } from "./paging.js";

async function otherMembers(ctx: ModuleContext, householdId: string, userId: string) {
  return listOtherMembersWithUsers(ctx.db, householdId, userId);
}

/** Checks an Owner leaving others behind named a next Owner who is one of them. */
async function nextOwnerFor(ctx: ModuleContext, current: HouseholdMembership, viewer: Viewer, nextOwnerId: string) {
  const others = await otherMembers(ctx, current.householdId, viewer.userId);
  if (current.role !== HOUSEHOLD_OWNER_ROLE || others.length === 0) {
    return { others, nextOwner: null };
  }
  if (!nextOwnerId) {
    throw new ConnectError("name the next Owner of your current household", Code.FailedPrecondition);
  }
  if (!others.some((o) => o.user.id === nextOwnerId)) {
    throw new ConnectError("the next Owner must be a member of your current household", Code.InvalidArgument);
  }
  return { others, nextOwner: nextOwnerId };
}

function checkFits(cap: bigint, used: bigint, reserved: bigint, incoming: bigint): void {
  if (used + reserved + incoming > cap) {
    throw new ConnectError("the household does not have room for your data and copies", Code.ResourceExhausted);
  }
}

/** Joins the person to the invite's household, creating it for a new household invite. */
async function joinTarget(ctx: ModuleContext, invite: ResolvedInvite, viewer: Viewer, householdName: string): Promise<string> {
  if (invite.kind === "new-household") {
    const name = required(householdName, "household_name");
    const created = await createHouseholdFor(ctx, viewer.userId, name);
    await ctx.db.transaction(async (tx) => {
      await createHousehold(tx, {
        householdId: created.id,
        storageCapBytes: invite.allowance.storageCapBytes,
        enabledApps: invite.allowance.enabledApps,
        memberLimit: invite.allowance.memberLimit,
      });
      await markHouseholdInviteRedeemed(tx, invite.id, { userId: viewer.userId, householdId: created.id });
    });
    return created.id;
  }
  // The invite already holds the seat, so joining needs no new seat check.
  await ctx.db.transaction(async (tx) => {
    await createMember(tx, {
      organizationId: invite.householdId,
      userId: viewer.userId,
      role: invite.role,
      createdAt: new Date(),
    });
    await markInvitationAccepted(tx, invite.id);
  });
  return invite.householdId;
}

/** Takes the person out of their household, handing ownership on first when others remain. */
async function leave(ctx: ModuleContext, current: HouseholdMembership, viewer: Viewer, nextOwner: string | null): Promise<void> {
  if (nextOwner) {
    await transferOwnership(ctx, current.householdId, viewer.userId, nextOwner);
  }
  await withHouseholdLock(ctx, current.householdId, async () => {
    await deleteMember(ctx.db, current.householdId, viewer.userId);
  });
}

// Using invites, moving between households, and leaving.
export const module: ApiModule = {
  name: "iam-joining",
  rpc(router, ctx) {
    router.rpc(IamService.method.getInvite, async (req, call) => {
      const invite = await resolveInvite(ctx.db, req.invite);
      const inviter = await getUserById(ctx.db, invite.inviterId);
      const org = invite.kind === "member" ? await getOrganization(ctx.db, invite.householdId) : null;
      const base = {
        kind: invite.kind === "member" ? InviteKind.MEMBER : InviteKind.NEW_HOUSEHOLD,
        email: invite.email,
        inviterName: inviter?.name ?? "",
        householdName: org?.name ?? "",
        role: invite.kind === "member" ? roleToWire(invite.role) : Role.OWNER,
        expiresAt: timestampFromDate(invite.expiresAt),
      };
      const { viewer, household } = await requestContext(call.values, ctx);
      if (!viewer || !household) {
        return base;
      }
      const current = await loadHousehold(ctx.db, household.householdId);
      const others = await otherMembers(ctx, household.householdId, viewer.userId);
      const isOwner = household.role === HOUSEHOLD_OWNER_ROLE;
      return {
        ...base,
        move: {
          currentHousehold: current?.message,
          privateBytes: await billedBytes(ctx, await privateObjectsOf(ctx, viewer.userId, household.householdId)),
          mustChooseNextOwner: isOwner && others.length > 0,
          nextOwnerCandidates: isOwner
            ? others.map((o) => ({ user: userMessage(o.user), role: roleToWire(o.member.role as HouseholdRole) }))
            : [],
          closesCurrentHousehold: others.length === 0,
        },
      };
    });

    router.rpc(IamService.method.listCopyableItems, async (req, call) => {
      const { viewer, household } = await requireHouseholdMember(call, ctx);
      const only = req.app ? appFromWire(req.app) : null;
      const all = (await sharedItemsOf(ctx, household.householdId)).filter((c) => !only || c.app === only);
      const after = decodePageToken(req.pageToken);
      const start = after ? Number(after) : 0;
      const limit = pageSize(req.pageSize);
      const page = all.slice(start, start + limit);
      return {
        items: page.map((c) => ({
          ref: { app: appToWire(c.app), kind: c.item.kind, id: c.item.id },
          name: c.item.name,
          sizeBytes: c.item.sizeBytes,
          uploadedByCaller: c.item.uploadedBy === viewer.userId,
        })),
        nextPageToken: start + limit < all.length ? encodePageToken(String(start + limit)) : "",
      };
    });

    router.rpc(IamService.method.joinHousehold, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const invite = await resolveInvite(ctx.db, req.invite);
      if (invite.email !== viewer.email.toLowerCase()) {
        throw new ConnectError("this invite is for another email address", Code.PermissionDenied);
      }
      const current = await getHouseholdByUserId(ctx.db, viewer.userId);
      if (current && invite.kind === "member" && current.householdId === invite.householdId) {
        throw new ConnectError("you are already in this household", Code.AlreadyExists);
      }
      const grace = await getGracePeriodByUserId(ctx.db, viewer.userId);
      const fromHouseholdId = current?.householdId ?? grace?.householdId ?? null;

      // Check everything that can fail before changing anything.
      const handoff = current ? await nextOwnerFor(ctx, current, viewer, req.nextOwnerUserId) : { others: [], nextOwner: null };
      if (req.copyItems.length > 0 && !current) {
        throw new ConnectError("there is no household to copy from", Code.FailedPrecondition);
      }
      const chosen: ChosenItem[] = current
        ? pickItems(
            await sharedItemsOf(ctx, current.householdId),
            req.copyItems.map((r) => ({ app: appFromWire(r.app), kind: r.kind, id: r.id })),
          )
        : [];
      const incoming =
        (fromHouseholdId ? await billedBytes(ctx, await privateObjectsOf(ctx, viewer.userId, fromHouseholdId)) : 0n) +
        chosen.reduce((sum, c) => sum + c.item.sizeBytes, 0n);
      if (invite.kind === "new-household") {
        checkFits(invite.allowance.storageCapBytes, 0n, 0n, incoming);
      } else {
        const target = await getHousehold(ctx.db, invite.householdId);
        if (!target) throw new ConnectError("that household no longer exists", Code.NotFound);
        checkFits(target.storageCapBytes, target.usedBytes, target.reservedBytes, incoming);
      }

      if (current) {
        await leave(ctx, current, viewer, handoff.nextOwner);
      }
      const householdId = await joinTarget(ctx, invite, viewer, req.householdName);
      if (fromHouseholdId) {
        await movePrivateData(ctx, viewer.userId, fromHouseholdId, householdId);
      }
      await copySharedItems(ctx, chosen, householdId, viewer.userId);
      if (current && handoff.others.length === 0) {
        await closeHousehold(ctx, current.householdId);
      }
      return { household: (await loadHousehold(ctx.db, householdId))?.message };
    });

    router.rpc(IamService.method.leaveHousehold, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const current = await getHouseholdByUserId(ctx.db, viewer.userId);
      if (!current) {
        throw new ConnectError("you are not in a household", Code.FailedPrecondition);
      }
      const handoff = await nextOwnerFor(ctx, current, viewer, req.nextOwnerUserId);
      const org = await getOrganization(ctx.db, current.householdId);
      await leave(ctx, current, viewer, handoff.nextOwner);
      // A household left empty stays until this grace period ends, then the worker closes it.
      await startGracePeriod(ctx, viewer.userId, { id: current.householdId, name: org?.name ?? "" });
      return {};
    });
  },
};
