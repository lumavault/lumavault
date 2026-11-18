import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuth } from "./auth/auth.js";
import { type Config, loadConfig } from "./config.js";
import { RPC_PREFIX, RPC_READ_MAX_BYTES } from "./constants.js";
import { createDatabase } from "./db/index.js";
import { createEmailService } from "./email/emails.js";
import { createMailer } from "./email/mailer.js";
import { createStorageGateway } from "./services/storage-gateway.js";
import { type ApiModule, loadModules, type ModuleContext, stopModules } from "./modules.js";
import { requestKey } from "./request.js";

const ALLOWED = "http://localhost:3000";
const OTHER = "https://evil.example";

const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost:1/unused",
  LUMAVAULT_GATEWAY_URL: "http://localhost:8080",
  LUMAVAULT_TICKET_SECRET: "t",
  LUMAVAULT_SERVICE_KEY: "s",
  BETTER_AUTH_SECRET: "a",
  LUMAVAULT_WEB_ORIGINS: `${ALLOWED}, http://localhost:3001/`,
  LUMAVAULT_PORTAL_URL: "http://localhost:3000",
};

function testContext(): ModuleContext {
  const config: Config = loadConfig(testEnv);
  // The pool never connects; these tests make no database calls.
  const { db } = createDatabase(config.databaseUrl);
  const auth = createAuth({
    db,
    tables: {},
    secret: "test-secret-that-is-at-least-32-bytes-long",
    baseURL: config.apiUrl,
    trustedOrigins: config.webOrigins,
    passkeyRpID: "localhost",
    sendMagicLink: async () => {},
  });
  const email = createEmailService(createMailer({ from: config.mailFrom, log: () => {} }));
  const gateway = createStorageGateway({ baseUrl: config.gatewayUrl, serviceKey: config.serviceKey });
  return { config, db, auth, email, gateway, apps: [] };
}

// Registers two IamService methods the way a real router file would.
const setupModule: ApiModule = {
  name: "test-setup",
  rpc(router) {
    router.rpc(IamService.method.getSetupStatus, (_req, ctx) => ({
      needsSetup: ctx.values.get(requestKey)?.headers.get("x-test") === "yes",
    }));
    router.rpc(IamService.method.completeSetup, () => ({}));
  },
};

describe("createApp", () => {
  const app = createApp(testContext(), [setupModule]);
  const client = (useHttpGet: boolean) =>
    createClient(
      IamService,
      createConnectTransport({
        baseUrl: `http://api.test${RPC_PREFIX}`,
        useHttpGet,
        fetch: async (input, init) => app.request(new Request(input, init)),
        interceptors: [
          (next) => (req) => {
            req.header.set("x-test", "yes");
            return next(req);
          },
        ],
      }),
    );

  it("serves the health check", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers a POST RPC and passes the request to the handler", async () => {
    expect(await client(false).getSetupStatus({})).toMatchObject({ needsSetup: true });
  });

  it("answers a side-effect-free RPC over GET", async () => {
    const seen: string[] = [];
    const getApp = createApp(testContext(), [setupModule]);
    const getClient = createClient(
      IamService,
      createConnectTransport({
        baseUrl: `http://api.test${RPC_PREFIX}`,
        useHttpGet: true,
        fetch: async (input, init) => {
          const req = new Request(input, init);
          seen.push(req.method);
          return getApp.request(req);
        },
      }),
    );
    await getClient.getSetupStatus({});
    expect(seen).toEqual(["GET"]);
  });

  it("rejects messages over 1 MiB", async () => {
    const err = await client(false)
      .completeSetup({ name: "x".repeat(RPC_READ_MAX_BYTES + 1) })
      .catch((e: unknown) => e);
    expect(ConnectError.from(err).code).toBe(Code.ResourceExhausted);
  });

  it("returns 404 for a method no router registered", async () => {
    const res = await app.request(`${RPC_PREFIX}/lumavault.iam.v1.IamService/GetViewer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("allows CORS preflight from a listed origin, with credentials", async () => {
    const res = await app.request(`${RPC_PREFIX}/lumavault.iam.v1.IamService/GetSetupStatus`, {
      method: "OPTIONS",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("rejects an unlisted origin, including on GET", async () => {
    for (const method of ["OPTIONS", "GET", "POST"]) {
      const res = await app.request("/healthz", { method, headers: { origin: OTHER } });
      expect(res.status, method).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("refuses two router files registering the same method", () => {
    expect(() => createApp(testContext(), [setupModule, { ...setupModule, name: "copy" }])).toThrow(
      /registered by two router files/,
    );
  });
});

describe("loadModules", () => {
  let src: string;

  beforeAll(async () => {
    src = await mkdtemp(join(tmpdir(), "lv-modules-"));
    await mkdir(join(src, "routers", "iam"), { recursive: true });
    await mkdir(join(src, "workers"));
    await writeFile(join(src, "routers", "iam", "viewer.js"), 'export const module = { name: "viewer" };\n');
    await writeFile(join(src, "routers", "helper.js"), "export const notAModule = 1;\n");
    await writeFile(join(src, "workers", "sweeper.js"), 'export const module = { name: "sweeper" };\n');
  });

  afterAll(async () => {
    await rm(src, { recursive: true, force: true });
  });

  it("picks up new files in subfolders without code changes, and skips helpers", async () => {
    expect((await loadModules(src)).map((m) => m.name)).toEqual(["viewer", "sweeper"]);
    await writeFile(join(src, "routers", "photos.js"), 'export const module = { name: "photos" };\n');
    expect((await loadModules(src)).map((m) => m.name)).toEqual(["viewer", "photos", "sweeper"]);
  });

  it("rejects a module without a name", async () => {
    const bad = await mkdtemp(join(tmpdir(), "lv-modules-bad-"));
    await mkdir(join(bad, "workers"));
    await writeFile(join(bad, "workers", "x.js"), "export const module = {};\n");
    await expect(loadModules(bad)).rejects.toThrow(/without a name/);
    await rm(bad, { recursive: true, force: true });
  });

  it("loads the real modules once each and skips helpers next to them", async () => {
    const names = (await loadModules()).map((m) => m.name);
    expect(names).toContain("auth-org-lockdown");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("stopModules", () => {
  it("stops in reverse order and keeps going after a failure", async () => {
    const order: string[] = [];
    const mods: ApiModule[] = [
      { name: "a", stop: () => void order.push("a") },
      {
        name: "b",
        stop: () => {
          order.push("b");
          throw new Error("b failed");
        },
      },
      { name: "c", stop: () => void order.push("c") },
    ];
    await expect(stopModules(mods)).rejects.toThrow(/failed to stop/);
    expect(order).toEqual(["c", "b", "a"]);
  });
});

describe("loadConfig", () => {
  it("normalizes origins and derives the API URL", () => {
    const config = loadConfig(testEnv);
    expect(config.webOrigins).toEqual([ALLOWED, "http://localhost:3001"]);
    expect(config.apiUrl).toBe("http://localhost:4000");
  });

  it("requires 32-byte secrets outside tests and lists every problem", () => {
    const env = { ...testEnv, NODE_ENV: "production", LUMAVAULT_WEB_ORIGINS: "not a url" };
    expect(() => loadConfig(env)).toThrow(
      /LUMAVAULT_TICKET_SECRET: must be at least 32 bytes[\s\S]*BETTER_AUTH_SECRET[\s\S]*LUMAVAULT_WEB_ORIGINS/,
    );
  });

  it("requires the database and gateway URLs", () => {
    expect(() => loadConfig({ NODE_ENV: "test" })).toThrow(/DATABASE_URL[\s\S]*LUMAVAULT_GATEWAY_URL/);
  });
});
