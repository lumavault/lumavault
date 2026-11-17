import { type AnyRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { appRoute, publicRoute, rootRoute } from "./layout/routes";

// Each folder under src/routes exports a route, or several as routes, attached to appRoute or
// publicRoute. New pages are picked up here without editing this file, so page issues never share it.
const pages = import.meta.glob<{ route?: AnyRoute; routes?: AnyRoute[] }>("./routes/*/route.tsx", { eager: true });

export function buildRouteTree() {
  const routes = Object.values(pages).flatMap((m) => [...(m.route ? [m.route] : []), ...(m.routes ?? [])]);
  const under = (parent: AnyRoute) => routes.filter((r) => r.options.getParentRoute?.() === parent);
  return rootRoute.addChildren([appRoute.addChildren(under(appRoute)), publicRoute.addChildren(under(publicRoute))]);
}

export function createPortalRouter(history?: RouterHistory) {
  // Unknown paths render at the root, outside the signed-in layout, so its login redirect
  // can never loop on a page that does not exist.
  return createRouter({ routeTree: buildRouteTree(), history, defaultPreload: "intent", notFoundMode: "root" });
}
