import { type ConnectRouter, createConnectRouter, createContextValues } from "@connectrpc/connect";
import {
  type UniversalHandler,
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { AUTH_BASE_PATH } from "./auth/constants.js";
import {
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  CORS_EXPOSE_HEADERS,
  HEALTH_PATH,
  RPC_PREFIX,
  RPC_READ_MAX_BYTES,
} from "./constants.js";
import type { ApiModule, ModuleContext } from "./modules.js";
import { clientIpKey, requestKey } from "./request.js";

/** Builds the HTTP app: health check, module routes, Better Auth, and Connect RPCs. */
export function createApp(ctx: ModuleContext, modules: ApiModule[]): Hono {
  const allowed = new Set(ctx.config.webOrigins);
  const app = new Hono();

  // Browsers always send Origin on cross-site requests. Refusing unlisted ones stops other
  // sites from using a visitor's cookies, even on GET calls that skip CORS preflight.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !allowed.has(origin)) {
      return c.json({ error: "origin not allowed" }, 403);
    }
    return next();
  });

  app.use(
    "*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : null),
      credentials: true,
      allowMethods: CORS_ALLOW_METHODS,
      allowHeaders: CORS_ALLOW_HEADERS,
      exposeHeaders: CORS_EXPOSE_HEADERS,
    }),
  );

  app.get(HEALTH_PATH, (c) => c.json({ status: "ok" }));

  for (const m of modules) {
    m.http?.(app, ctx);
  }

  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => ctx.auth.handler(c.req.raw));

  const rpc = rpcHandlers(ctx, modules);
  app.on(["GET", "POST"], `${RPC_PREFIX}/*`, async (c) => {
    const handler = rpc.get(c.req.path.slice(RPC_PREFIX.length));
    if (!handler || !handler.allowedMethods.includes(c.req.method)) {
      return c.json({ code: "unimplemented", message: "no such method" }, 404);
    }
    const req = universalServerRequestFromFetch(c.req.raw, {});
    req.contextValues = createContextValues().set(requestKey, c.req.raw).set(clientIpKey, clientIp(c));
    return universalServerResponseToFetch(await handler(req));
  });

  return app;
}

// Only the Node server knows the socket address; in-memory test requests have none.
function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function rpcHandlers(ctx: ModuleContext, modules: ApiModule[]): Map<string, UniversalHandler> {
  const router: ConnectRouter = createConnectRouter({ readMaxBytes: RPC_READ_MAX_BYTES });
  for (const m of modules) {
    m.rpc?.(router, ctx);
  }
  const byPath = new Map<string, UniversalHandler>();
  for (const handler of router.handlers) {
    if (byPath.has(handler.requestPath)) {
      throw new Error(`${handler.requestPath} is registered by two router files`);
    }
    byPath.set(handler.requestPath, handler);
  }
  return byPath;
}
