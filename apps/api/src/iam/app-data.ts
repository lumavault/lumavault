import type { IamApp } from "./constants.js";
import type { ModuleContext } from "#/modules.js";

/** A shared item an app offers for copying when someone moves to another household. */
export interface AppSharedItem {
  /** App-defined kind and ID, such as an album or a movie. */
  kind: string;
  id: string;
  name: string;
  sizeBytes: bigint;
  /** Who uploaded it, or null if their account is gone. */
  uploadedBy: string | null;
  /** The stored objects behind the item, which IAM copies before the app copies its rows. */
  objectIds: string[];
}

/**
 * What each media app tells IAM about its data, so IAM can move people between households
 * without knowing app details. Each app decides what is private to a person and what is
 * shared with the household. IAM always does the billing and Storage Gateway work first, then
 * asks the app to update its own rows.
 */
export interface AppDataHooks {
  app: IamApp;
  /** Stored objects that are this person's private data in the household. */
  privateObjects(ctx: ModuleContext, userId: string, householdId: string): Promise<string[]>;
  /** Moves the app's rows for a person's private data. Their objects are already billed to the new household. */
  movePrivateData(ctx: ModuleContext, userId: string, fromHouseholdId: string, toHouseholdId: string): Promise<void>;
  /** Deletes the app's rows for a person's private data. Their objects are already released. */
  deletePrivateData(ctx: ModuleContext, userId: string, householdId: string): Promise<void>;
  /** Shared items in the household that a member may copy. */
  sharedItems(ctx: ModuleContext, householdId: string): Promise<AppSharedItem[]>;
  /**
   * Creates the app's rows for copied items in the new household, owned by userId. copies maps
   * each original object ID to its copy, already billed to the new household.
   */
  copySharedItems(
    ctx: ModuleContext,
    items: AppSharedItem[],
    toHouseholdId: string,
    userId: string,
    copies: Map<string, string>,
  ): Promise<void>;
  /** Deletes everything the app holds for a closed household. Its objects are already released. */
  deleteHousehold(ctx: ModuleContext, householdId: string): Promise<void>;
}
