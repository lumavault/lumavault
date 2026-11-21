import type { iamInstanceSettings } from "#/db/schemas/iam.js";

/** The single instance settings row. */
export type InstanceSettings = typeof iamInstanceSettings.$inferSelect;
