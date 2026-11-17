import { useViewer } from "@lumavault/ui";
import { createRoute } from "@tanstack/react-router";
import { ShieldIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { appRoute } from "@/layout/routes";
import { HouseholdsPanel } from "./households-panel";
import { InvitesPanel } from "./invites-panel";
import { UsersPanel } from "./users-panel";

/** The server owner's console. The API enforces Super-Admin on every call; this only hides the page. */
export function AdminPage() {
  const viewer = useViewer();
  if (!viewer.data?.user?.isSuperAdmin) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldIcon />
          </EmptyMedia>
          <EmptyTitle>Only the server owner can open this</EmptyTitle>
          <EmptyDescription>Ask the person who runs this LumaVault server for help with households and storage.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Tabs defaultValue="households">
      <TabsList>
        <TabsTrigger value="households">Households</TabsTrigger>
        <TabsTrigger value="invites">Invites</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
      </TabsList>
      <TabsContent value="households">
        <HouseholdsPanel />
      </TabsContent>
      <TabsContent value="invites">
        <InvitesPanel />
      </TabsContent>
      <TabsContent value="users">
        <UsersPanel />
      </TabsContent>
    </Tabs>
  );
}

export const route = createRoute({ getParentRoute: () => appRoute, path: "/admin", component: AdminPage, staticData: { title: "Server admin" } });
