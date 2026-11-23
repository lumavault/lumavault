import type { IamApp } from "./constants.js";

/**
 * What a media app tells IAM about its data, so IAM can act across apps without knowing app
 * details. An app module provides these through its appData field. Hooks are added here only
 * when a platform flow needs one.
 */
export interface AppDataHooks {
  app: IamApp;
}
