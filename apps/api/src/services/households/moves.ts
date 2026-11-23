import { Code, ConnectError } from "@connectrpc/connect";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import { createMember } from "#/data/auth/member/create-member.js";
import { deleteMember } from "#/data/auth/member/delete-member.js";
import { getMembersWithUsers } from "#/data/auth/member/get-member.js";
import { updateMemberRole } from "#/data/auth/member/update-member.js";
import { createOrganization } from "#/data/auth/organization/create-organization.js";
import { deleteOrganization } from "#/data/auth/organization/delete-organization.js";
import { getOrganizationById } from "#/data/auth/organization/get-organization.js";
import { deleteGracePeriod } from "#/data/iam/grace-period/delete-grace-period.js";
import { getGracePeriodByUserId } from "#/data/iam/grace-period/get-grace-period.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { getHouseholdByUserId, getHouseholdsForUpdate } from "#/data/iam/household/get-household.js";
import type { HouseholdMembership } from "#/data/iam/household/types.js";
import { setHouseholdClosesAt } from "#/data/iam/household/update-household.js";
import { getActiveObjectClaim, getActiveObjectClaimsForUpdate, getActiveObjectIdsByHousehold } from "#/data/iam/object-claim/get-object-claim.js";
import type { DbOrTx } from "#/db/index.js";
import type { ItemRef, SharedItem } from "#/iam/app-data.js";
import { EMPTY_HOUSEHOLD_TTL_MS, type IamApp } from "#/iam/constants.js";
import { privateObjectIds } from "#/iam/grace.js";
import type { ModuleContext } from "#/server/modules.js";
import { billCopyInTx, moveObjectsInTx, releaseObject } from "#/services/quotas/index.js";
import type { MoveInput, MoveResult } from "./types.js";

type MoveContext = Pick<ModuleContext, "db" | "gateway" | "apps">;

/** A shared item chosen for copying, with the app it belongs to. */
interface ChosenItem {
  app: IamApp;
  item: SharedItem;
}

/** A Gateway copy of one object, made before the move's transaction and billed inside it. */
interface ObjectCopy {
  copyId: string;
  app: IamApp;
  bytes: bigint;
}

/**
 * Moves a person into a household, creating it first for a household creation invite. Their
 * private data comes along from the household they are in, or from the one holding it for
 * their grace period, and the chosen shared items are copied. Everything but the Gateway
 * copies happens in one transaction; the copies are made first and deleted if it fails.
 */
export async function moveMember(ctx: MoveContext, input: MoveInput): Promise<MoveResult> {
  const now = input.now ?? new Date();
  const membership = await getHouseholdByUserId(ctx.db, input.userId);
  const grace = membership ? null : await getGracePeriodByUserId(ctx.db, input.userId);
  const sourceId = membership?.householdId ?? grace?.householdId ?? null;
  if (input.target.kind === "existing" && membership?.householdId === input.target.householdId) {
    throw new ConnectError("you are already in this household", Code.AlreadyExists);
  }

  const chosen = await pickItems(ctx, membership, input.copyItems ?? []);
  const copies = await copyObjects(ctx, chosen);
  try {
    return await ctx.db.transaction(async (tx) => {
      const targetId = input.target.kind === "new" ? await createTarget(tx, input.target, now) : input.target.householdId;
      const objectIds = sourceId && sourceId !== targetId ? await privateObjectIds(tx, ctx.apps, input.userId, sourceId) : [];
      // Lock in the ledger's order, claims then households, so moves never deadlock with refunds.
      if (objectIds.length > 0) {
        await getActiveObjectClaimsForUpdate(tx, objectIds);
      }
      const locked = await getHouseholdsForUpdate(tx, [...new Set([sourceId, targetId].filter((id) => id !== null))].sort());
      const target = locked.find((h) => h.householdId === targetId);
      if (!target) {
        throw new ConnectError("household not found", Code.NotFound);
      }
      const current = await getHouseholdByUserId(tx, input.userId);
      if (current?.householdId !== membership?.householdId) {
        throw new ConnectError("your household changed while moving; try again", Code.Aborted);
      }

      if (current) {
        await leaveHouseholdInTx(tx, { userId: input.userId, membership: current, nextOwnerUserId: input.nextOwnerUserId, now });
      }
      const role = input.target.kind === "new" ? HOUSEHOLD_OWNER_ROLE : input.target.role;
      await createMember(tx, { organizationId: targetId, userId: input.userId, role, createdAt: now });
      if (target.closesAt) {
        await setHouseholdClosesAt(tx, targetId, null);
      }

      let movedBytes = 0n;
      if (sourceId && sourceId !== targetId) {
        movedBytes = (await moveObjectsInTx(tx, objectIds, sourceId, targetId)).bytes;
        for (const app of ctx.apps) {
          await app.movePrivateData(tx, input.userId, sourceId, targetId);
        }
      }

      let copiedBytes = 0n;
      for (const copy of copies.values()) {
        await billCopyInTx(tx, { objectId: copy.copyId, app: copy.app, bytes: copy.bytes, toHouseholdId: targetId, uploadedBy: input.userId });
        copiedBytes += copy.bytes;
      }
      const copyIds = new Map([...copies].map(([objectId, c]) => [objectId, c.copyId]));
      for (const app of ctx.apps) {
        const items = chosen.filter((c) => c.app === app.app).map((c) => c.item);
        if (items.length > 0) {
          await app.copySharedItems(tx, items, targetId, input.userId, copyIds);
        }
      }

      await deleteGracePeriod(tx, input.userId);
      await input.onJoined?.(tx, targetId);
      return { householdId: targetId, movedBytes, copiedBytes };
    });
  } catch (err) {
    await deleteCopies(ctx, copies);
    throw err;
  }
}

/**
 * Takes a member out of their household inside the caller's transaction. An Owner leaving
 * others behind hands ownership to nextOwnerUserId first. The last member to go sets the
 * household's close date. The caller locks the household row first.
 */
export async function leaveHouseholdInTx(
  tx: DbOrTx,
  input: { userId: string; membership: HouseholdMembership; nextOwnerUserId?: string; now: Date },
): Promise<void> {
  const householdId = input.membership.householdId;
  const others = (await getMembersWithUsers(tx, householdId)).filter((m) => m.user.id !== input.userId);
  if (input.membership.role === HOUSEHOLD_OWNER_ROLE && others.length > 0) {
    if (!input.nextOwnerUserId) {
      throw new ConnectError("name the next Owner before leaving", Code.FailedPrecondition);
    }
    if (!others.some((m) => m.user.id === input.nextOwnerUserId)) {
      throw new ConnectError("the next Owner must be another member of the household", Code.FailedPrecondition);
    }
    await updateMemberRole(tx, householdId, input.nextOwnerUserId, HOUSEHOLD_OWNER_ROLE);
  }
  await deleteMember(tx, householdId, input.userId);
  if (others.length === 0) {
    await setHouseholdClosesAt(tx, householdId, new Date(input.now.getTime() + EMPTY_HOUSEHOLD_TTL_MS));
  }
}

/**
 * Deletes a person's private data in a household and refunds it there, once. Ends their grace
 * period if it was for this household. Safe to run again after a crash.
 */
export async function deletePrivateData(ctx: MoveContext, userId: string, householdId: string): Promise<void> {
  for (const objectId of await privateObjectIds(ctx.db, ctx.apps, userId, householdId)) {
    await releaseObject(ctx, objectId, { onlyFromHouseholdId: householdId });
  }
  await ctx.db.transaction(async (tx) => {
    for (const app of ctx.apps) {
      await app.deletePrivateData(tx, userId, householdId);
    }
    const grace = await getGracePeriodByUserId(tx, userId);
    if (grace?.householdId === householdId) {
      await deleteGracePeriod(tx, userId);
    }
  });
}

/**
 * Closes a household with no members: releases every object it pays for, once, then deletes
 * the apps' records and the household itself. Safe to run again after a crash.
 */
export async function closeHousehold(ctx: MoveContext, householdId: string): Promise<void> {
  if (!(await getOrganizationById(ctx.db, householdId))) {
    return;
  }
  if ((await getMembersWithUsers(ctx.db, householdId)).length > 0) {
    throw new ConnectError("a household with members cannot be closed", Code.FailedPrecondition);
  }
  for (const objectId of await getActiveObjectIdsByHousehold(ctx.db, householdId)) {
    await releaseObject(ctx, objectId, { onlyFromHouseholdId: householdId });
  }
  await ctx.db.transaction(async (tx) => {
    const locked = await getHouseholdsForUpdate(tx, [householdId]);
    if (locked.length === 0) {
      return;
    }
    // Checked again under the lock, in case someone joined while objects were released.
    if ((await getMembersWithUsers(tx, householdId)).length > 0) {
      throw new ConnectError("a household with members cannot be closed", Code.FailedPrecondition);
    }
    for (const app of ctx.apps) {
      await app.deleteHousehold(tx, householdId);
    }
    await deleteOrganization(tx, householdId);
  });
}

/** Finds the chosen items among the household's shared items. Only a current member may copy. */
async function pickItems(ctx: MoveContext, membership: HouseholdMembership | null, refs: ItemRef[]): Promise<ChosenItem[]> {
  if (refs.length === 0) {
    return [];
  }
  if (!membership) {
    throw new ConnectError("only members of a household can copy its shared items", Code.FailedPrecondition);
  }
  const offered = await Promise.all(
    ctx.apps.map(async (a) => (await a.sharedItems(ctx.db, membership.householdId)).map((item) => ({ app: a.app, item }))),
  );
  const all = offered.flat();
  return refs.map((ref) => {
    const found = all.find((c) => c.app === ref.app && c.item.kind === ref.kind && c.item.id === ref.id);
    if (!found) {
      throw new ConnectError(`shared ${ref.kind} ${ref.id} is no longer available`, Code.NotFound);
    }
    return found;
  });
}

/** Copies every object behind the chosen items on the Gateway, once each. Cleans up if any copy fails. */
async function copyObjects(ctx: MoveContext, chosen: ChosenItem[]): Promise<Map<string, ObjectCopy>> {
  const copies = new Map<string, ObjectCopy>();
  try {
    for (const objectId of new Set(chosen.flatMap((c) => c.item.objectIds))) {
      const claim = await getActiveObjectClaim(ctx.db, objectId);
      if (!claim) {
        throw new ConnectError("one of the items you chose is no longer available", Code.NotFound);
      }
      const stored = await ctx.gateway.copy(objectId);
      copies.set(objectId, { copyId: stored.id, app: claim.app, bytes: stored.sizeBytes });
    }
  } catch (err) {
    await deleteCopies(ctx, copies);
    throw err;
  }
  return copies;
}

async function deleteCopies(ctx: MoveContext, copies: Map<string, ObjectCopy>): Promise<void> {
  for (const copy of copies.values()) {
    await ctx.gateway.delete(copy.copyId);
  }
}

/** Creates the household a creation invite asked for, inside the move's transaction. */
async function createTarget(tx: DbOrTx, target: Extract<MoveInput["target"], { kind: "new" }>, now: Date): Promise<string> {
  const org = await createOrganization(tx, { name: target.name, createdAt: now });
  await createHousehold(tx, { householdId: org.id, ...target.allowance });
  return org.id;
}
