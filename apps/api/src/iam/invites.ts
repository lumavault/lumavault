import { Code, ConnectError } from "@connectrpc/connect";
import type { InviteRef } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { HOUSEHOLD_MEMBER_ROLE, type HouseholdRole } from "#/auth/constants.js";
import { getInvitation } from "#/data/auth/invitation/get-invitation.js";
import { getHouseholdInviteByTokenHash } from "#/data/iam/household-invite/get-household-invite.js";
import type { DbOrTx } from "#/db/index.js";
import type { IamApp } from "./constants.js";
import { hashSecret } from "./secrets.js";

export type ResolvedInvite =
  | {
      kind: "new-household";
      id: string;
      email: string;
      inviterId: string;
      expiresAt: Date;
      allowance: { storageCapBytes: bigint; enabledApps: IamApp[]; memberLimit: number };
    }
  | {
      kind: "member";
      id: string;
      email: string;
      inviterId: string;
      expiresAt: Date;
      householdId: string;
      role: HouseholdRole;
    };

function invalid(): ConnectError {
  return new ConnectError("this invite link is not valid", Code.NotFound);
}

/** Looks up the invite an invite link carries, refusing ones that are expired, revoked, or used. */
export async function resolveInvite(db: DbOrTx, ref: InviteRef | undefined, now: Date = new Date()): Promise<ResolvedInvite> {
  const which = ref?.invite;
  if (which?.case === "householdInviteToken" && which.value) {
    const row = await getHouseholdInviteByTokenHash(db, hashSecret(which.value));
    if (!row || row.revokedAt || row.expiresAt <= now) throw invalid();
    if (row.redeemedAt) throw new ConnectError("this invite link was already used", Code.FailedPrecondition);
    return {
      kind: "new-household",
      id: row.id,
      email: row.email,
      inviterId: row.createdBy,
      expiresAt: row.expiresAt,
      allowance: { storageCapBytes: row.storageCapBytes, enabledApps: row.enabledApps, memberLimit: row.memberLimit },
    };
  }
  if (which?.case === "memberInviteId" && which.value) {
    const row = await getInvitation(db, which.value);
    if (!row || row.status === "canceled" || row.status === "rejected" || row.expiresAt <= now) throw invalid();
    if (row.status === "accepted") throw new ConnectError("this invite link was already used", Code.FailedPrecondition);
    return {
      kind: "member",
      id: row.id,
      email: row.email.toLowerCase(),
      inviterId: row.inviterId,
      expiresAt: row.expiresAt,
      householdId: row.organizationId,
      role: (row.role as HouseholdRole | null) ?? HOUSEHOLD_MEMBER_ROLE,
    };
  }
  throw new ConnectError("invite is required", Code.InvalidArgument);
}
