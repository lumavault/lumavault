import * as React from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@lumavault/ui/components/ui/breadcrumb'
import { Separator } from '@lumavault/ui/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@lumavault/ui/components/ui/sidebar'
import { TooltipProvider } from '@lumavault/ui/components/ui/tooltip'
import { Link, useLocation } from '@tanstack/react-router'

import {
  ADMIN_NAV,
  AppSidebar,
  isRouteActive,
  PRIMARY_NAV,
} from './app-sidebar'

// Account lives in the user menu rather than the sidebar nav.
const ACCOUNT_PAGE = { title: 'Account', to: '/account' }

interface BreadcrumbTrail {
  parent?: { label: string; to: string }
  current: string
}

function breadcrumbsFor(pathname: string): BreadcrumbTrail {
  if (pathname === '/' || pathname === '') {
    return { current: 'Home' }
  }
  if (pathname.startsWith('/admin')) {
    const page = ADMIN_NAV.find((item) => isRouteActive(pathname, item.to))
    return {
      parent: { label: 'Server Admin', to: '/admin/households' },
      current: page?.title ?? 'Households',
    }
  }
  const page = [...PRIMARY_NAV, ACCOUNT_PAGE].find(
    (item) => item.to !== '/' && isRouteActive(pathname, item.to),
  )
  return {
    parent: { label: 'Portal', to: '/' },
    current: page?.title ?? 'Portal',
  }
}

export interface PortalShellProps {
  children: React.ReactNode
}

export function PortalShell({ children }: PortalShellProps) {
  const location = useLocation()
  const trail = breadcrumbsFor(location.pathname)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <Breadcrumb>
                <BreadcrumbList>
                  {trail.parent ? (
                    <>
                      <BreadcrumbItem className="hidden md:block">
                        <BreadcrumbLink
                          render={<Link to={trail.parent.to as never} />}
                        >
                          {trail.parent.label}
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden md:block" />
                    </>
                  ) : null}
                  <BreadcrumbItem>
                    <BreadcrumbPage>{trail.current}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 pt-0 md:p-6 md:pt-0">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
