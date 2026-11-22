import type { iamPairingRequests } from "#/db/schemas/iam.js";

/** A pairing request row. */
export type PairingRequest = typeof iamPairingRequests.$inferSelect;

/** What it takes to start pairing an Apple TV. */
export type NewPairingRequest = Pick<
  typeof iamPairingRequests.$inferInsert,
  "code" | "deviceSecretHash" | "deviceName" | "requesterIp" | "expiresAt"
>;

/** Who approved a pairing, and the household the Apple TV opens in. */
export interface PairingApproval {
  approvedBy: string;
  householdId: string;
}
