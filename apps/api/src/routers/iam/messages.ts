// Builders for IamService messages from database rows. Shared by the IAM router files.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { HouseholdSchema, UsageSchema, UserSchema } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import type { organization, user } from "#/db/schemas/auth.js";
import type { iamHouseholds } from "#/db/schemas/iam.js";
import { appToWire } from "./convert.js";

type UserRow = typeof user.$inferSelect;
type OrgRow = Pick<typeof organization.$inferSelect, "id" | "name" | "createdAt">;
type HouseholdRow = typeof iamHouseholds.$inferSelect;

export function userMessage(u: UserRow): MessageInitShape<typeof UserSchema> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    imageUrl: u.image ?? "",
    isSuperAdmin: (u.role ?? "").split(",").some((r) => r.trim() === SUPER_ADMIN_ROLE),
    banned: u.banned ?? false,
    createdAt: timestampFromDate(u.createdAt),
  };
}

/** Usage with remaining bytes clamped at zero, since a cap may be lowered below usage. */
export function usageMessage(h: HouseholdRow | undefined): MessageInitShape<typeof UsageSchema> {
  const used = h?.usedBytes ?? 0n;
  const reserved = h?.reservedBytes ?? 0n;
  const left = (h?.storageCapBytes ?? 0n) - used - reserved;
  return { usedBytes: used, reservedBytes: reserved, remainingBytes: left > 0n ? left : 0n };
}

export function householdMessage(org: OrgRow, h: HouseholdRow | undefined): MessageInitShape<typeof HouseholdSchema> {
  return {
    id: org.id,
    name: org.name,
    suspended: h?.suspended ?? false,
    allowance: {
      storageCapBytes: h?.storageCapBytes ?? 0n,
      enabledApps: (h?.enabledApps ?? []).map(appToWire),
      memberLimit: h?.memberLimit ?? 0,
    },
    createdAt: timestampFromDate(org.createdAt),
  };
}
