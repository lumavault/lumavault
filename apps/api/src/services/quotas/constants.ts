import type { IamApp } from "#/iam/constants.js";

// Storage Namespace enum values from proto/lumavault/v1/storage.proto, one per app.
export const APP_NAMESPACE: Record<IamApp, number> = {
  photos: 1,
  cinema: 2,
  arcade: 3,
};

// Only these apps have an instance-wide shared library curated by the Super-Admin.
export const SHARED_LIBRARY_APPS: readonly IamApp[] = ["cinema", "arcade"];

// A reservation lives as long as its upload ticket.
export const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

// The sweeper expires at most this many reservations per transaction.
export const SWEEP_BATCH_SIZE = 500;
