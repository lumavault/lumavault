import type { GetViewerResponse } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { LayoutGridIcon, ShieldIcon, TvIcon, UsersIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { HouseholdHeader } from "./household-header";
import { NavMain, type NavItem } from "./nav-main";
import { NavUser } from "./nav-user";

export function AppSidebar({ viewer, ...props }: ComponentProps<typeof Sidebar> & { viewer: GetViewerResponse }) {
  const items: NavItem[] = [
    { title: "Apps", to: "/", icon: <LayoutGridIcon /> },
    { title: "Household", to: "/household", icon: <UsersIcon /> },
    { title: "Pair Apple TV", to: "/pair", icon: <TvIcon /> },
  ];
  if (viewer.user?.isSuperAdmin) {
    items.push({ title: "Server admin", to: "/admin", icon: <ShieldIcon /> });
  }
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <HouseholdHeader />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>{viewer.user && <NavUser user={viewer.user} />}</SidebarFooter>
    </Sidebar>
  );
}

