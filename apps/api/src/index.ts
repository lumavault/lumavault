// Server entry: reads config, loads modules, serves on PORT, and shuts down cleanly.
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./auth/auth.js";
import { loadConfig } from "./config.js";
import { SHUTDOWN_TIMEOUT_MS } from "./constants.js";
import { createDatabase, ensureSchemas } from "./db/index.js";
import * as authTables from "./db/schemas/auth.js";
import { createEmailService } from "./email/emails.js";
import { createMailer } from "./email/mailer.js";
import { createStorageGateway } from "./services/storage-gateway.js";
import { loadModules, type ModuleContext, startModules, stopModules } from "./modules.js";

const config = loadConfig(process.env);
const database = createDatabase(config.databaseUrl);
await ensureSchemas(database.db);

const mailer = createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom });
const email = createEmailService(mailer);

const auth = createAuth({
  db: database.db,
  tables: authTables,
  secret: config.authSecret,
  baseURL: config.apiUrl,
  trustedOrigins: config.webOrigins,
  passkeyRpID: new URL(config.portalUrl).hostname,
  sendMagicLink: ({ email: to, url }) => email.sendMagicLink(to, { url }),
  cookieDomain: config.cookieDomain,
});

const gateway = createStorageGateway({ baseUrl: config.gatewayUrl, serviceKey: config.serviceKey });
const modules = await loadModules();
const apps = modules.flatMap((m) => (m.appData ? [m.appData] : []));
const ctx: ModuleContext = { config, db: database.db, auth, email, gateway, apps };
const app = createApp(ctx, modules);
await startModules(modules, ctx);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.info(`api listening on port ${info.port} with ${modules.length} modules`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`${signal} received, shutting down`);
  const forceExit = setTimeout(() => {
    console.error("shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();
  try {
    await stopModules(modules);
  } catch (err) {
    console.error(err);
  }
  // close waits for open requests to finish before the pool goes away.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mailer.close();
  await database.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
