import { Code, ConnectError } from "@connectrpc/connect";
import { PORTAL_LOGIN_PATH, RETURN_TO_PARAM, useActiveHousehold, useViewer } from "@lumavault/ui";
import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSidebar } from "./app-sidebar";
import { SiteHeader } from "./site-header";

/** The dashboard shell from shadcn's dashboard block, shown only to signed-in viewers. */
export function AppLayout() {
  const viewer = useViewer();
  const { suspended, membership } = useActiveHousehold();
  const location = useRouterState({ select: (s) => s.location });

  if (viewer.error && ConnectError.from(viewer.error).code === Code.Unauthenticated) {
    // Never wrap the login page's own URL in a return link, which would nest forever.
    if (location.pathname === PORTAL_LOGIN_PATH) return null;
    return <Navigate to={PORTAL_LOGIN_PATH} search={{ [RETURN_TO_PARAM]: location.href }} replace />;
  }
  if (!viewer.data) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 12)" } as CSSProperties}
    >
      <AppSidebar variant="inset" viewer={viewer.data} />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
          {suspended && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{membership?.household?.name} is suspended</AlertTitle>
              <AlertDescription>The server owner paused this household. Switch to another household to keep going.</AlertDescription>
            </Alert>
          )}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
