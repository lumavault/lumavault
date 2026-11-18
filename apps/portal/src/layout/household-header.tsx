import { useHousehold } from "@lumavault/ui";
import { HouseIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/** The product name and the viewer's household. Each person belongs to at most one. */
export function HouseholdHeader() {
  const { household } = useHousehold();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <HouseIcon />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">LumaVault</span>
            <span className="truncate text-xs text-muted-foreground">{household?.name ?? "No household"}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
