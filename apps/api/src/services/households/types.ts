import type { Organization } from "#/data/auth/organization/types.js";
import type { User } from "#/data/auth/user/types.js";
import type { HouseholdRole } from "#/auth/constants.js";
import type { Household, NewHousehold } from "#/data/iam/household/types.js";
import type { DbOrTx } from "#/db/index.js";
import type { ItemRef } from "#/iam/app-data.js";

/** A household with its name and Owner, everything an IamService Household needs. */
export interface HouseholdView {
  organization: Organization;
  household: Household;
  /** Empty when the household has no Owner, which only a broken transfer could cause. */
  ownerUserId: string;
}

/** One row of the Super-Admin household list. */
export interface HouseholdSummary {
  organization: Organization;
  household: Household;
  /** Null when the household has no Owner. */
  owner: User | null;
  memberCount: number;
  /** Member invites still pending and not expired. They hold seats under the member limit. */
  pendingInviteCount: number;
  /** Bytes held for people in their grace period, already part of used bytes. */
  heldBytes: bigint;
}

/** Where a move takes someone: a household that exists, or a new one from a household creation invite. */
export type MoveTarget =
  | { kind: "existing"; householdId: string; role: HouseholdRole }
  | { kind: "new"; name: string; allowance: Omit<NewHousehold, "householdId"> };

export interface MoveInput {
  userId: string;
  target: MoveTarget;
  /** Required when the person owns their current household and others remain. */
  nextOwnerUserId?: string;
  /** Shared items to copy from the person's current household. */
  copyItems?: ItemRef[];
  /** Runs inside the move's transaction once the person has joined, for example to mark an invite used. */
  onJoined?: (tx: DbOrTx, householdId: string) => Promise<void>;
  now?: Date;
}

export interface MoveResult {
  householdId: string;
  /** Private data now billed to the new household. */
  movedBytes: bigint;
  /** Copies billed to the new household. */
  copiedBytes: bigint;
}
