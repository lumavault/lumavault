import type { DbOrTx } from "#/db/index.js";
import type { IamApp } from "./constants.js";

/** A shared item an app offers for copying when someone moves, such as an album or a movie. */
export interface SharedItem {
  /** App-defined kind and ID, together unique within the app. */
  kind: string;
  id: string;
  name: string;
  /** Who uploaded it, or null if their account is gone. */
  uploadedBy: string | null;
  /** The stored objects behind the item. IAM copies and bills these; the app copies its own records. */
  objectIds: string[];
}

/** Names one shared item of one app. */
export interface ItemRef {
  app: IamApp;
  kind: string;
  id: string;
}

/**
 * What a media app tells IAM about its data, so IAM can move people between households
 * without knowing app details. Each app decides what is private to a person and what is
 * shared with the household. IAM does all billing and Storage Gateway work itself; hooks
 * only read or change the app's own records, using the database or transaction they are given.
 * An app module provides these through its appData field.
 */
export interface AppDataHooks {
  app: IamApp;
  /** Stored object IDs that are this person's private data in the household. */
  privateObjects(db: DbOrTx, userId: string, householdId: string): Promise<string[]>;
  /** Shared items in the household that a member may copy into another household. */
  sharedItems(db: DbOrTx, householdId: string): Promise<SharedItem[]>;
  /**
   * Creates the app's records for copied items in another household, owned there by userId.
   * copies maps each original object ID to its copy, already billed to that household.
   */
  copySharedItems(db: DbOrTx, items: SharedItem[], toHouseholdId: string, userId: string, copies: Map<string, string>): Promise<void>;
  /** Moves the app's records for a person's private data. Its objects are already billed to the new household. */
  movePrivateData(db: DbOrTx, userId: string, fromHouseholdId: string, toHouseholdId: string): Promise<void>;
  /** Deletes the app's records for a person's private data. Its objects are already released. */
  deletePrivateData(db: DbOrTx, userId: string, householdId: string): Promise<void>;
  /** Deletes everything the app holds for a household that is closing. Its objects are already released. */
  deleteHousehold(db: DbOrTx, householdId: string): Promise<void>;
}
