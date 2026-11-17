import { useRouterState } from "@tanstack/react-router";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** The page title comes from the matched route's staticData.title. */
export function SiteHeader() {
  const title = useRouterState({
    select: (s) => [...s.matches].reverse().find((m) => m.staticData?.title)?.staticData.title ?? "LumaVault",
  });
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        <h1 className="text-base font-medium">{title}</h1>
      </div>
    </header>
  );
}
