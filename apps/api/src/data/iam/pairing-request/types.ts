import type { iamPairingRequests } from "#/db/schemas/iam.js";

/** A pairing request row. */
export type PairingRequest = typeof iamPairingRequests.$inferSelect;

/** What it takes to start an Apple TV pairing. */
export type NewPairingRequest = Pick<
  typeof iamPairingRequests.$inferInsert,
  "code" | "deviceSecretHash" | "deviceName" | "requesterIp" | "expiresAt"
>;
