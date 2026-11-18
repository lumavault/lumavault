import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ConnectRouter } from "@connectrpc/connect";
import type { Hono } from "hono";
import type { Auth } from "./auth/auth.js";
import type { Config } from "./config.js";
import { MODULE_DIRS } from "./constants.js";
import type { Db } from "./db/index.js";
import type { AppDataHooks } from "./iam/app-data.js";
import type { EmailService } from "./email/emails.js";
import type { StorageGateway } from "./services/storage-gateway.js";
import { listSourceFiles } from "./source-files.js";

/** What every module gets: config, the database, Better Auth, email, and the Storage Gateway. */
export interface ModuleContext {
  config: Config;
  db: Db;
  auth: Auth;
  email: EmailService;
  gateway: StorageGateway;
  /** Data hooks from every loaded app module. Filled in once modules load. */
  apps: AppDataHooks[];
}

/**
 * A file under src/auth, src/routers, or src/workers becomes part of the server by exporting
 * a module. Files without one are ignored, so helpers can sit next to modules.
 */
export interface ApiModule {
  name: string;
  /** Registers this file's RPC methods. Each router file owns its own methods. */
  rpc?(router: ConnectRouter, ctx: ModuleContext): void;
  /** Adds Hono middleware or routes. Runs before Better Auth and RPC routes are mounted. */
  http?(app: Hono, ctx: ModuleContext): void;
  /** Starts background work. Called once after the server is built. */
  start?(ctx: ModuleContext): Promise<void> | void;
  /** Stops background work. Called on shutdown, in reverse start order. */
  stop?(): Promise<void> | void;
  /** How IAM moves this app's data when people change household. Media app routers set it. */
  appData?: AppDataHooks;
}

export const SRC_DIR = fileURLToPath(new URL("./", import.meta.url));

/** Imports every module under the module folders of srcDir, in a stable order. */
export async function loadModules(srcDir: string = SRC_DIR): Promise<ApiModule[]> {
  const modules: ApiModule[] = [];
  for (const dir of MODULE_DIRS) {
    for (const file of await listSourceFiles(join(srcDir, dir))) {
      const exported = ((await import(pathToFileURL(file).href)) as { module?: unknown }).module;
      if (exported === undefined) {
        continue;
      }
      if (!isApiModule(exported)) {
        throw new Error(`${file} exports a module without a name`);
      }
      modules.push(exported);
    }
  }
  return modules;
}

function isApiModule(value: unknown): value is ApiModule {
  return typeof value === "object" && value !== null && typeof (value as ApiModule).name === "string";
}

export async function startModules(modules: ApiModule[], ctx: ModuleContext): Promise<void> {
  for (const m of modules) {
    await m.start?.(ctx);
  }
}

/** Stops every module even if some fail, then reports the failures together. */
export async function stopModules(modules: ApiModule[]): Promise<void> {
  const failures: unknown[] = [];
  for (const m of [...modules].reverse()) {
    try {
      await m.stop?.();
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "some modules failed to stop");
  }
}
