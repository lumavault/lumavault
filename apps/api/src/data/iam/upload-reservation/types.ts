import type { iamUploadReservations } from "#/db/schemas/iam.js";

/** An upload reservation row. */
export type UploadReservation = typeof iamUploadReservations.$inferSelect;

/** What it takes to hold bytes for a new upload. */
export type NewUploadReservation = Pick<
  typeof iamUploadReservations.$inferInsert,
  "householdId" | "userId" | "app" | "bytes" | "expiresAt"
>;
