import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type GetViewerResponseSchema, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { getUserById } from "#/data/auth/user/get-user.js";
import { getGracePeriodByUserId, getHeldBytesByHousehold } from "#/data/iam/grace-period/get-grace-period.js";
import { getHouseholdByUserId } from "#/data/iam/household/get-household.js";
import type { Db } from "#/db/index.js";
import { roleToWire } from "./convert.js";
import { loadHousehold } from "./household-queries.js";
import { usageMessage, userMessage } from "./messages.js";

/** Everything a client needs about who is signed in. Reads the database, not the request. */
export async function buildViewer(db: Db, userId: string): Promise<MessageInitShape<typeof GetViewerResponseSchema>> {
  const u = await getUserById(db, userId);
  if (!u) {
    throw new Error(`user ${userId} disappeared`);
  }
  const grace = await getGracePeriodByUserId(db, userId);
  const gracePeriod = grace
    ? { formerHouseholdName: grace.householdName, privateBytes: grace.heldBytes, deleteAt: timestampFromDate(grace.deleteAt) }
    : undefined;

  const membership = await getHouseholdByUserId(db, userId);
  const loaded = membership ? await loadHousehold(db, membership.householdId) : null;
  if (!membership || !loaded) {
    return { user: userMessage(u), role: Role.UNSPECIFIED, gracePeriod };
  }
  return {
    user: userMessage(u),
    household: loaded.message,
    role: roleToWire(membership.role),
    usage: usageMessage(loaded.allowance, await getHeldBytesByHousehold(db, membership.householdId)),
    gracePeriod,
  };
}
