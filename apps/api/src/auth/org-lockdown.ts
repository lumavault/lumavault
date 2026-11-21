import { AUTH_BASE_PATH, LOCKED_AUTH_PREFIXES } from "./constants.js";
import type { ApiModule } from "#/server/modules.js";

/** True for Better Auth paths that only IamService may use, server-side. */
export function isLockedAuthPath(path: string): boolean {
  if (!path.startsWith(`${AUTH_BASE_PATH}/`)) {
    return false;
  }
  const rest = path.slice(AUTH_BASE_PATH.length);
  return LOCKED_AUTH_PREFIXES.some((prefix) => rest.startsWith(prefix));
}

// Households and Super-Admin actions go through IamService, which checks quotas, member
// limits, and the last-Admin rule before calling Better Auth on the server. Clients calling
// Better Auth's own organization or admin endpoints would skip those checks.
export const module: ApiModule = {
  name: "auth-org-lockdown",
  http(app) {
    app.use(`${AUTH_BASE_PATH}/*`, async (c, next) => {
      if (isLockedAuthPath(c.req.path)) {
        return c.json({ code: "FORBIDDEN", message: "use IamService for households and admin actions" }, 403);
      }
      return next();
    });
  },
};
