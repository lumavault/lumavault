import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamService, type InviteRef, InviteKind, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { HOUSEHOLD_MEMBER_ROLE, HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import { isHouseholdRole } from "#/auth/role-checks.js";
import { getInvitationById, getInvitationForUpdate, getPendingInvitationsByOrganizationId } from "#/data/auth/invitation/get-invitation.js";
import type { Invitation } from "#/data/auth/invitation/types.js";
import { cancelAllPendingInvitationsByEmail, markInvitationAccepted } from "#/data/auth/invitation/update-invitation.js";
import { createMember } from "#/data/auth/member/create-member.js";
import { getMembersWithUsers, getOwnerUserId } from "#/data/auth/member/get-member.js";
import { createOrganization } from "#/data/auth/organization/create-organization.js";
import { getOrganizationById } from "#/data/auth/organization/get-organization.js";
import { getUserById, getUserForUpdate } from "#/data/auth/user/get-user.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { getHouseholdByUserId, getHouseholdForUpdate } from "#/data/iam/household/get-household.js";
import {
  getHouseholdInviteByTokenHash,
  getHouseholdInviteByTokenHashForUpdate,
} from "#/data/iam/household-invite/get-household-invite.js";
import type { HouseholdInvite } from "#/data/iam/household-invite/types.js";
import { redeemHouseholdInvite, revokeUnusedHouseholdInvitesByEmail } from "#/data/iam/household-invite/update-household-invite.js";
import type { DbOrTx } from "#/db/index.js";
import { requireSignedIn } from "#/guards.js";
import { hashSecret } from "#/lib/secrets.js";
import type { ApiModule } from "#/server/modules.js";
import { householdToWire, required, roleToWire } from "./convert.js";

type ResolvedInvite = { kind: "household"; invite: HouseholdInvite } | { kind: "member"; invite: Invitation };

/** The invite a link names, optionally locked. NotFound when there is none. */
async function findInvite(db: DbOrTx, ref: InviteRef | undefined, lock: boolean): Promise<ResolvedInvite> {
  const which = ref?.invite;
  if (which?.case === "householdInviteToken") {
    const hash = hashSecret(required(which.value, "household_invite_token"));
    const invite = lock ? await getHouseholdInviteByTokenHashForUpdate(db, hash) : await getHouseholdInviteByTokenHash(db, hash);
    if (invite) return { kind: "household", invite };
  } else if (which?.case === "memberInviteId") {
    const id = required(which.value, "member_invite_id");
    const invite = lock ? await getInvitationForUpdate(db, id) : await getInvitationById(db, id);
    if (invite) return { kind: "member", invite };
  } else {
    throw new ConnectError("invite is required", Code.InvalidArgument);
  }
  throw new ConnectError("invite not found", Code.NotFound);
}

/** Throws a distinct error for an invite that was used, revoked, or has expired. */
function checkUsable(resolved: ResolvedInvite, now: Date): void {
  const { invite } = resolved;
  const used = resolved.kind === "household" ? resolved.invite.redeemedAt !== null : resolved.invite.status === "accepted";
  const revoked = resolved.kind === "household" ? resolved.invite.revokedAt !== null : resolved.invite.status !== "pending";
  if (used) {
    throw new ConnectError("invite was already used", Code.FailedPrecondition);
  }
  if (revoked) {
    throw new ConnectError("invite was revoked", Code.FailedPrecondition);
  }
  if (invite.expiresAt <= now) {
    throw new ConnectError("invite has expired", Code.FailedPrecondition);
  }
}

/** The role a member invite grants. Invitations without a role invite a Member. */
function memberInviteRole(invite: Invitation) {
  const role = invite.role ?? HOUSEHOLD_MEMBER_ROLE;
  return isHouseholdRole(role) && role !== HOUSEHOLD_OWNER_ROLE ? role : HOUSEHOLD_MEMBER_ROLE;
}

/** Creates the household a household creation invite promises, with the caller as Owner. */
async function createFromInvite(tx: DbOrTx, invite: HouseholdInvite, userId: string, name: string, now: Date) {
  const org = await createOrganization(tx, { name, createdAt: now });
  await createMember(tx, { organizationId: org.id, userId, role: HOUSEHOLD_OWNER_ROLE, createdAt: now });
  const household = await createHousehold(tx, {
    householdId: org.id,
    storageCapBytes: invite.storageCapBytes,
    enabledApps: invite.enabledApps,
    memberLimit: invite.memberLimit,
  });
  await redeemHouseholdInvite(tx, invite.id, { userId, householdId: org.id, now });
  return householdToWire(org, household, userId);
}

/** Adds the caller to the household a member invite names, if a seat is free. */
async function joinFromInvite(tx: DbOrTx, invite: Invitation, userId: string, now: Date) {
  const household = await getHouseholdForUpdate(tx, invite.organizationId);
  const org = await getOrganizationById(tx, invite.organizationId);
  if (!household || !org) {
    throw new ConnectError("household not found", Code.NotFound);
  }
  const members = await getMembersWithUsers(tx, household.householdId);
  // This invite already holds one of the pending seats, so only the others count against it.
  const otherInvites = (await getPendingInvitationsByOrganizationId(tx, household.householdId, now)).filter((i) => i.id !== invite.id);
  if (members.length + otherInvites.length >= household.memberLimit) {
    throw new ConnectError("the household has no free seats", Code.ResourceExhausted);
  }
  await createMember(tx, { organizationId: household.householdId, userId, role: memberInviteRole(invite), createdAt: now });
  await markInvitationAccepted(tx, invite.id);
  const ownerUserId = (await getOwnerUserId(tx, household.householdId)) ?? "";
  return householdToWire(org, household, ownerUserId);
}

// Joining is only for people with no household. Moving between households is not supported yet.
export const module: ApiModule = {
  name: "iam-joining",
  rpc(router, ctx) {
    router.rpc(IamService.method.getInvite, async (req) => {
      const resolved = await findInvite(ctx.db, req.invite, false);
      checkUsable(resolved, new Date());
      if (resolved.kind === "household") {
        const inviter = await getUserById(ctx.db, resolved.invite.createdBy);
        return {
          kind: InviteKind.NEW_HOUSEHOLD,
          email: resolved.invite.email,
          inviterName: inviter?.name ?? "",
          role: Role.OWNER,
          expiresAt: timestampFromDate(resolved.invite.expiresAt),
        };
      }
      const [inviter, org] = await Promise.all([
        getUserById(ctx.db, resolved.invite.inviterId),
        getOrganizationById(ctx.db, resolved.invite.organizationId),
      ]);
      return {
        kind: InviteKind.MEMBER,
        email: resolved.invite.email.toLowerCase(),
        inviterName: inviter?.name ?? "",
        householdName: org?.name ?? "",
        role: roleToWire(memberInviteRole(resolved.invite)),
        expiresAt: timestampFromDate(resolved.invite.expiresAt),
      };
    });

    router.rpc(IamService.method.joinHousehold, async (req, call) => {
      const viewer = await requireSignedIn(call, ctx);
      const now = new Date();
      // The user row lock makes joins by the same person run one at a time, so two invites
      // used at once still leave exactly one membership.
      const household = await ctx.db.transaction(async (tx) => {
        const user = await getUserForUpdate(tx, viewer.userId);
        if (!user) {
          throw new ConnectError("sign in required", Code.Unauthenticated);
        }
        if (await getHouseholdByUserId(tx, user.id)) {
          throw new ConnectError("you are already in a household; moving between households is not supported yet", Code.FailedPrecondition);
        }
        const resolved = await findInvite(tx, req.invite, true);
        checkUsable(resolved, now);
        const email = user.email.toLowerCase();
        if (resolved.invite.email.toLowerCase() !== email) {
          throw new ConnectError("this invite is for a different email address", Code.PermissionDenied);
        }
        const joined =
          resolved.kind === "household"
            ? await createFromInvite(tx, resolved.invite, user.id, required(req.householdName, "household_name"), now)
            : await joinFromInvite(tx, resolved.invite, user.id, now);
        await cancelAllPendingInvitationsByEmail(tx, email);
        await revokeUnusedHouseholdInvitesByEmail(tx, email, now);
        return joined;
      });
      return { household };
    });
  },
};
