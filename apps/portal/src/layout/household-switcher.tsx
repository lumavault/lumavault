import type { GetViewerResponse } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useSwitchHousehold } from "@lumavault/ui";
import { CheckIcon, ChevronsUpDownIcon, HouseIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/** Switches the active household for every LumaVault app at once, through the server session. */
export function HouseholdSwitcher({ viewer }: { viewer: GetViewerResponse }) {
  const switchHousehold = useSwitchHousehold();
  const active = viewer.memberships.find((m) => m.household?.id === viewer.activeHouseholdId);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}>
            <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <HouseIcon />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">LumaVault</span>
              <span className="truncate text-xs text-muted-foreground">{active?.household?.name ?? "No household"}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Households</DropdownMenuLabel>
              {viewer.memberships.map((m) => (
                <DropdownMenuItem
                  key={m.household?.id}
                  onClick={() => m.household && switchHousehold.mutate({ householdId: m.household.id })}
                >
                  {m.household?.name}
                  {m.household?.suspended && <span className="text-xs text-muted-foreground">suspended</span>}
                  {m.household?.id === viewer.activeHouseholdId && <CheckIcon className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
