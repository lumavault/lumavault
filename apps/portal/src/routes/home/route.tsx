import { appInfo } from "@/lib/apps";
import { useHousehold } from "@lumavault/ui";
import { createRoute } from "@tanstack/react-router";
import { ArrowUpRightIcon, HouseIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { config } from "@/config";
import { appRoute } from "@/layout/routes";

/** Launcher cards for the active household's enabled apps. */
export function HomePage() {
  const { household, suspended } = useHousehold();
  if (!household) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HouseIcon />
          </EmptyMedia>
          <EmptyTitle>You are not in a household yet</EmptyTitle>
          <EmptyDescription>Open an invite link from the server owner or a household Admin to join one.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const apps = (household.allowance?.enabledApps ?? []).map(appInfo).filter((a) => a !== undefined);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {apps.map((app) => (
        <Card key={app.key}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <app.icon />
              {app.name}
            </CardTitle>
            <CardDescription>{app.description}</CardDescription>
            <CardAction>
              {suspended ? (
                <Button variant="outline" size="sm" disabled>
                  Open
                </Button>
              ) : (
                <a className={buttonVariants({ variant: "outline", size: "sm" })} href={config.appUrls[app.key]}>
                  Open
                  <ArrowUpRightIcon data-icon="inline-end" />
                </a>
              )}
            </CardAction>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export const route = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: HomePage,
  staticData: { title: "Apps" },
});
