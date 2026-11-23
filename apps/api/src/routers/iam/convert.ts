// Conversions between IamService wire types and the API's own values. Shared by the IAM
// router files; it registers no RPCs itself.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  App,
  type GracePeriodSchema,
  type HouseholdInviteSchema,
  type HouseholdSchema,
  type HouseholdSummarySchema,
  type MemberInviteSchema,
  type MemberSchema,
  Role,
  type UsageSchema,
  type UserSchema,
} from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import {
  HOUSEHOLD_ADMIN_ROLE,
  HOUSEHOLD_MEMBER_ROLE,
  HOUSEHOLD_OWNER_ROLE,
  type HouseholdRole,
  SUPER_ADMIN_ROLE,
} from "#/auth/constants.js";
import { hasUserRole, isHouseholdRole } from "#/auth/role-checks.js";
import type { Invitation } from "#/data/auth/invitation/types.js";
import type { MemberWithUser } from "#/data/auth/member/types.js";
import type { Organization } from "#/data/auth/organization/types.js";
import type { User } from "#/data/auth/user/types.js";
import type { GracePeriod } from "#/data/iam/grace-period/types.js";
import type { HouseholdInvite } from "#/data/iam/household-invite/types.js";
import type { Household } from "#/data/iam/household/types.js";
import type { IamApp } from "#/iam/constants.js";
import type { HouseholdSummary, HouseholdView } from "#/services/households/index.js";

const APP_TO_WIRE: Record<IamApp, App> = { photos: App.PHOTOS, cinema: App.CINEMA, arcade: App.ARCADE };

export function appToWire(app: IamApp): App {
  return APP_TO_WIRE[app];
}

/** The app named by a request, rejecting APP_UNSPECIFIED and unknown values. */
export function appFromWire(app: App): IamApp {
  const found = (Object.entries(APP_TO_WIRE) as [IamApp, App][]).find(([, wire]) => wire === app);
  if (!found) {
    throw new ConnectError("app is required", Code.InvalidArgument);
  }
  return found[0];
}

export function appsFromWire(apps: App[]): IamApp[] {
  return [...new Set(apps.map(appFromWire))];
}

const ROLE_TO_WIRE: Record<HouseholdRole, Role> = {
  [HOUSEHOLD_OWNER_ROLE]: Role.OWNER,
  [HOUSEHOLD_ADMIN_ROLE]: Role.ADMIN,
  [HOUSEHOLD_MEMBER_ROLE]: Role.MEMBER,
};

export function roleToWire(role: HouseholdRole): Role {
  return ROLE_TO_WIRE[role];
}

/** A role someone can be invited or changed to. Owner moves only through TransferOwnership. */
export function assignableRoleFromWire(role: Role): typeof HOUSEHOLD_ADMIN_ROLE | typeof HOUSEHOLD_MEMBER_ROLE {
  if (role === Role.ADMIN) return HOUSEHOLD_ADMIN_ROLE;
  if (role === Role.MEMBER) return HOUSEHOLD_MEMBER_ROLE;
  throw new ConnectError("role must be Admin or Member", Code.InvalidArgument);
}

/** A required string field, trimmed. */
export function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConnectError(`${field} is required`, Code.InvalidArgument);
  }
  return trimmed;
}

/** A user row as an IamService User. */
export function userToWire(u: User): MessageInitShape<typeof UserSchema> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    imageUrl: u.image ?? "",
    isSuperAdmin: hasUserRole(u.role, SUPER_ADMIN_ROLE),
    createdAt: timestampFromDate(u.createdAt),
  };
}

/** A household's name and identity, its allowance row, and its Owner as an IamService Household. */
export function householdToWire(org: Organization, h: Household, ownerUserId: string): MessageInitShape<typeof HouseholdSchema> {
  return {
    id: org.id,
    name: org.name,
    allowance: {
      storageCapBytes: h.storageCapBytes,
      enabledApps: h.enabledApps.map(appToWire),
      memberLimit: h.memberLimit,
    },
    ownerUserId,
    createdAt: timestampFromDate(org.createdAt),
  };
}

/**
 * Usage with remaining bytes floored at zero, since a cap may be lowered below usage. Held
 * bytes are already part of used bytes; they are reported so the household can see them.
 */
export function usageToWire(h: Household, heldBytes: bigint): MessageInitShape<typeof UsageSchema> {
  const left = h.storageCapBytes - h.usedBytes - h.reservedBytes;
  return { usedBytes: h.usedBytes, reservedBytes: h.reservedBytes, remainingBytes: left > 0n ? left : 0n, heldBytes };
}

export function gracePeriodToWire(g: GracePeriod): MessageInitShape<typeof GracePeriodSchema> {
  return { formerHouseholdName: g.householdName, privateBytes: g.heldBytes, deleteAt: timestampFromDate(g.deleteAt) };
}

/** A household creation invite row as an IamService HouseholdInvite. The secret is never stored, so never returned. */
export function householdInviteToWire(i: HouseholdInvite): MessageInitShape<typeof HouseholdInviteSchema> {
  return {
    id: i.id,
    email: i.email,
    allowance: { storageCapBytes: i.storageCapBytes, enabledApps: i.enabledApps.map(appToWire), memberLimit: i.memberLimit },
    note: i.note,
    expiresAt: timestampFromDate(i.expiresAt),
    createdAt: timestampFromDate(i.createdAt),
  };
}

export function householdSummaryToWire(s: HouseholdSummary): MessageInitShape<typeof HouseholdSummarySchema> {
  return {
    household: householdToWire(s.organization, s.household, s.owner?.id ?? ""),
    owner: s.owner ? userToWire(s.owner) : undefined,
    usage: usageToWire(s.household, s.heldBytes),
    memberCount: s.memberCount,
    pendingInviteCount: s.pendingInviteCount,
  };
}

export function householdViewToWire(v: HouseholdView): MessageInitShape<typeof HouseholdSchema> {
  return householdToWire(v.organization, v.household, v.ownerUserId);
}

/** A stored role string as a wire Role. Unknown values become ROLE_UNSPECIFIED. */
function storedRoleToWire(role: string | null): Role {
  return role && isHouseholdRole(role) ? roleToWire(role) : Role.UNSPECIFIED;
}

export function memberToWire(m: MemberWithUser): MessageInitShape<typeof MemberSchema> {
  return { user: userToWire(m.user), role: storedRoleToWire(m.member.role), joinedAt: timestampFromDate(m.member.createdAt) };
}

/** A member invitation as an IamService MemberInvite. Invitations without a role invite a Member. */
export function memberInviteToWire(i: Invitation): MessageInitShape<typeof MemberInviteSchema> {
  return { id: i.id, email: i.email, role: storedRoleToWire(i.role ?? HOUSEHOLD_MEMBER_ROLE), expiresAt: timestampFromDate(i.expiresAt) };
}
