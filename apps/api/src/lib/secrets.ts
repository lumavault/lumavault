import { createHash, randomBytes } from "node:crypto";

/** Lowercase hex SHA-256, the only form invite tokens and device secrets are stored in. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A URL-safe random secret with the given number of random bytes. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
