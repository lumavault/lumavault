import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "./app-layout";
import { PublicLayout } from "./public-layout";

// The route tree's fixed parents. Page folders under src/routes attach to one of these.
export const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <p className="p-6 text-muted-foreground">This page does not exist.</p>,
});

/** Signed-in pages, inside the dashboard sidebar. Signed-out visitors go to login. */
export const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });

/** Pages that work signed out, such as login and setup, on a plain centered card. */
export const publicRoute = createRoute({ getParentRoute: () => rootRoute, id: "public", component: PublicLayout });
