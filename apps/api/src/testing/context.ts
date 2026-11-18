// Test helpers for code that needs a real ModuleContext. Never imported by the server.
import { type ContextValues, createContextValues } from "@connectrpc/connect";
import { createAuth } from "#/auth/auth.js";
import { allowSignUp } from "#/auth/sign-up-gate.js";
import { loadConfig } from "#/config.js";
import * as authTables from "#/db/schemas/auth.js";
import type { TestDatabase } from "#/db/testing.js";
import { createEmailService, type EmailService } from "#/email/emails.js";
import { createMailer } from "#/email/mailer.js";
import type { ModuleContext } from "#/modules.js";
import { createStorageGateway, type StorageGateway } from "#/services/storage-gateway.js";
import { requestKey } from "#/request.js";

export const TEST_WEB_ORIGIN = "http://localhost:3000";
// Portal, Photos, Cinema, and Arcade.
export const TEST_APP_ORIGINS = [TEST_WEB_ORIGIN, "http://localhost:3001", "http://localhost:3002", "http://localhost:3003"];

export const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost:1/unused",
  LUMAVAULT_GATEWAY_URL: "http://localhost:8080",
  LUMAVAULT_TICKET_SECRET: "test-ticket-secret-that-is-32-bytes-or-more",
  LUMAVAULT_SERVICE_KEY: "test-service-key",
  BETTER_AUTH_SECRET: "test-auth-secret-that-is-32-bytes-or-more",
  LUMAVAULT_WEB_ORIGINS: TEST_APP_ORIGINS.join(","),
  LUMAVAULT_PORTAL_URL: TEST_WEB_ORIGIN,
};

/** Records every email instead of sending it. */
export function recordingEmail(): EmailService & { sent: { kind: string; to: string; url: string }[] } {
  const sent: { kind: string; to: string; url: string }[] = [];
  return {
    sent,
    async sendMagicLink(to, props) {
      sent.push({ kind: "magic-link", to, url: props.url });
    },
    async sendMemberInvite(to, props) {
      sent.push({ kind: "member-invite", to, url: props.url });
    },
    async sendHouseholdInvite(to, props) {
      sent.push({ kind: "household-invite", to, url: props.url });
    },
  };
}

/** A ModuleContext on a test database, with Better Auth wired to its tables. */
export function createTestContext(
  database: Pick<TestDatabase, "db">,
  options: { env?: Record<string, string>; email?: EmailService; gateway?: StorageGateway } = {},
): ModuleContext {
  const config = loadConfig({ ...TEST_ENV, ...options.env });
  const email = options.email ?? createEmailService(createMailer({ from: config.mailFrom, log: () => {} }));
  const auth = createAuth({
    db: database.db,
    tables: authTables,
    secret: config.authSecret,
    baseURL: config.apiUrl,
    trustedOrigins: config.webOrigins,
    passkeyRpID: "localhost",
    sendMagicLink: ({ email: to, url }) => email.sendMagicLink(to, { url }),
  });
  const gateway =
    options.gateway ?? createStorageGateway({ baseUrl: config.gatewayUrl, serviceKey: config.serviceKey });
  return { config, db: database.db, auth, email, gateway, apps: [] };
}

export interface TestUser {
  id: string;
  email: string;
  headers: Headers;
}

/** Signs up a user past the invite gate and returns bearer headers for their session. */
export async function signUp(ctx: ModuleContext, email: string): Promise<TestUser> {
  const res = await allowSignUp(() => ctx.auth.api.signUpEmail({ body: { name: email.split("@")[0] ?? email, email, password: "correct horse battery" } }));
  if (!res.token) {
    throw new Error(`sign-up for ${email} returned no session token`);
  }
  return { id: res.user.id, email, headers: new Headers({ authorization: `Bearer ${res.token}` }) };
}

/** Connect context values for an RPC sent with these headers. */
export function rpcValues(headers: Headers = new Headers()): ContextValues {
  return createContextValues().set(requestKey, new Request("http://api.test/api/rpc/x", { headers }));
}
