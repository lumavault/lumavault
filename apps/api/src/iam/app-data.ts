import type { DbOrTx } from "#/db/index.js";
import type { IamApp } from "./constants.js";

/**
 * What a media app tells IAM about its data, so IAM can handle people leaving a household
 * without knowing app details. Each app decides what is private to a person and what is
 * shared with the household. An app module provides these through its appData field.
 */
export interface AppDataHooks {
  app: IamApp;
  /** Stored object IDs that are this person's private data in the household. */
  privateObjects(db: DbOrTx, userId: string, householdId: string): Promise<string[]>;
}
