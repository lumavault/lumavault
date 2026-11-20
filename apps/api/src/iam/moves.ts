import { Code, ConnectError } from "@connectrpc/connect";
import { deleteOrganization } from "#/data/auth/organization/delete-organization.js";
import { listActiveObjectIdsByHousehold } from "#/data/iam/object-claim/get-object-claim.js";
import type { ModuleContext } from "#/modules.js";
import { copyObjectToHousehold, moveObjects, releaseObject } from "#/services/quotas/index.js";
import type { AppSharedItem } from "./app-data.js";
import type { IamApp } from "./constants.js";
import { endGracePeriod, privateObjectsOf } from "./grace.js";

/** A shared item chosen for copying, with the app it belongs to. */
export interface ChosenItem {
  app: IamApp;
  item: AppSharedItem;
}

/** Every shared item in the household, from every app. */
export async function sharedItemsOf(ctx: ModuleContext, householdId: string): Promise<ChosenItem[]> {
  const lists = await Promise.all(ctx.apps.map(async (a) => (await a.sharedItems(ctx, householdId)).map((item) => ({ app: a.app, item }))));
  return lists.flat();
}

/**
 * Moves a person's private data from one household to another: billing first, all or nothing,
 * then each app's own rows. Ends their grace period if they had one.
 */
export async function movePrivateData(ctx: ModuleContext, userId: string, fromHouseholdId: string, toHouseholdId: string): Promise<void> {
  const objects = await privateObjectsOf(ctx, userId, fromHouseholdId);
  await moveObjects(ctx, objects, fromHouseholdId, toHouseholdId);
  for (const a of ctx.apps) {
    await a.movePrivateData(ctx, userId, fromHouseholdId, toHouseholdId);
  }
  await endGracePeriod(ctx, userId);
}

/** Copies shared items into another household, owned there by userId. The source keeps its own. */
export async function copySharedItems(ctx: ModuleContext, items: ChosenItem[], toHouseholdId: string, userId: string): Promise<void> {
  for (const a of ctx.apps) {
    const mine = items.filter((i) => i.app === a.app).map((i) => i.item);
    if (mine.length === 0) continue;
    const copies = new Map<string, string>();
    for (const objectId of new Set(mine.flatMap((i) => i.objectIds))) {
      copies.set(objectId, (await copyObjectToHousehold(ctx, objectId, toHouseholdId, userId)).objectId);
    }
    await a.copySharedItems(ctx, mine, toHouseholdId, userId, copies);
  }
}

/** Deletes a person's private data in a household and refunds it, then ends their grace period. */
export async function deletePrivateData(ctx: ModuleContext, userId: string, householdId: string): Promise<void> {
  for (const objectId of await privateObjectsOf(ctx, userId, householdId)) {
    await releaseObject(ctx, objectId);
  }
  for (const a of ctx.apps) {
    await a.deletePrivateData(ctx, userId, householdId);
  }
  await endGracePeriod(ctx, userId);
}

/** Closes a household with no members left: deletes everything it stored, then the household. */
export async function closeHousehold(ctx: ModuleContext, householdId: string): Promise<void> {
  for (const objectId of await listActiveObjectIdsByHousehold(ctx.db, householdId)) {
    await releaseObject(ctx, objectId);
  }
  for (const a of ctx.apps) {
    await a.deleteHousehold(ctx, householdId);
  }
  // Deleting the organization removes its members, invites, and allowance row with it.
  await deleteOrganization(ctx.db, householdId);
}

/** Finds the chosen items among the household's shared items, rejecting any that are not there. */
export function pickItems(all: ChosenItem[], refs: { app: IamApp; kind: string; id: string }[]): ChosenItem[] {
  return refs.map((ref) => {
    const found = all.find((c) => c.app === ref.app && c.item.kind === ref.kind && c.item.id === ref.id);
    if (!found) {
      throw new ConnectError(`no shared ${ref.kind} ${ref.id} to copy`, Code.NotFound);
    }
    return found;
  });
}
