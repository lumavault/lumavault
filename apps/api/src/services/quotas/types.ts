import type { IamApp } from "#/iam/constants.js";

/** Who pays for an upload. */
export type Billing =
  | { kind: "household"; householdId: string }
  /** The instance-wide Cinema or Arcade library. Super-Admin only; billed to no one. */
  | { kind: "shared" };

export interface ReserveInput {
  userId: string;
  app: IamApp;
  sizeBytes: bigint;
  billing: Billing;
}

export interface Reservation {
  reservationId: string;
  householdId: string | null;
  expiresAt: Date;
}

export interface FinishInput {
  userId: string;
  reservationId: string;
  objectId: string;
}

export interface FinishedUpload {
  objectId: string;
  householdId: string | null;
  bytes: bigint;
}

export interface MovedObjects {
  /** Bytes now billed to the new household. */
  bytes: bigint;
  count: number;
}
