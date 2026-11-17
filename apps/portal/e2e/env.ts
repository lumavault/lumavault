// Ports and addresses for the end-to-end run, apart from the usual dev ports so both can run.
export const API_PORT = 4100;
export const PORTAL_PORT = 3100;
export const SMTP_PORT = 2525;
export const MAILBOX_PORT = 2526;

export const API_URL = `http://localhost:${API_PORT}`;
export const PORTAL_URL = `http://localhost:${PORTAL_PORT}`;
export const MAILBOX_URL = `http://localhost:${MAILBOX_PORT}`;

/** Postgres server for the run. The API recreates a database named lv_e2e on it. */
export const DATABASE_SERVER_URL = process.env.TEST_DATABASE_URL ?? "postgres://lumavault:lumavault@localhost:5432/lumavault";

export function e2eDatabaseUrl(): string {
  const url = new URL(DATABASE_SERVER_URL);
  url.pathname = "/lv_e2e";
  return url.toString();
}
