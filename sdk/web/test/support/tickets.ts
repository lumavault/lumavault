import { createHmac } from "node:crypto";

export const TEST_TICKET_SECRET = "sdk-test-ticket-secret-0123456789abcdef";
export const TEST_SERVICE_KEY = "sdk-test-service-key";

export const TICKET_ENV = {
  LUMAVAULT_TICKET_SECRET: TEST_TICKET_SECRET,
  LUMAVAULT_SERVICE_KEY: TEST_SERVICE_KEY,
};

type Claims = { k: "up"; ns: number; max: number } | { k: "rd"; obj: string } | { k: "rd"; chk: string };

/** Mints a ticket the way apps/api does, valid for an hour. Tests only. */
export function mintTicket(claims: Claims): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { k, ...rest } = claims;
  const body = Buffer.from(JSON.stringify({ k, exp, ...rest })).toString("base64url");
  const sig = createHmac("sha256", TEST_TICKET_SECRET).update(`v1.${body}`).digest("base64url");
  return `v1.${body}.${sig}`;
}
