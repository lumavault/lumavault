import type { IamApp } from "./lib/apps";

// Build-time settings, from Vite env variables. Defaults match local development.
const env = import.meta.env;

export const config = {
  apiUrl: env.VITE_API_URL ?? "http://localhost:4000",
  portalUrl: env.VITE_PORTAL_URL ?? "http://localhost:3000",
  appUrls: {
    photos: env.VITE_PHOTOS_URL ?? "http://localhost:3001",
    cinema: env.VITE_CINEMA_URL ?? "http://localhost:3002",
    arcade: env.VITE_ARCADE_URL ?? "http://localhost:3003",
  } satisfies Record<IamApp, string>,
  /** Run against the in-memory IamService instead of the API, for building pages offline. */
  useMock: env.VITE_USE_MOCK === "1",
};

/** Every LumaVault web origin, for checking where sign-in may return to. */
export const knownOrigins = [config.portalUrl, ...Object.values(config.appUrls)];
