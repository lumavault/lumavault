import * as React from 'react'
import { useSignOut } from '@lumavault/ui/auth'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@lumavault/ui/components/ui/avatar'
import { ModeToggle } from '@lumavault/ui/components/ui/custom/mode-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@lumavault/ui/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@lumavault/ui/components/ui/sidebar'
import { useViewer } from '@lumavault/ui/household'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import {
  Building2Icon,
  ChevronsUpDownIcon,
  HardDriveIcon,
  HomeIcon,
  LogOutIcon,
  MailIcon,
  TvIcon,
  UserCircleIcon,
  UsersIcon,
} from 'lucide-react'
import { toast } from 'sonner'

interface NavItem {
  title: string
  to: string
  icon: React.ComponentType
}

const PRIMARY_NAV: readonly NavItem[] = [
  { title: 'Home', to: '/', icon: HomeIcon },
  { title: 'Household', to: '/household', icon: UsersIcon },
  { title: 'Pair TV', to: '/pair', icon: TvIcon },
]

const ADMIN_NAV: readonly NavItem[] = [
  { title: 'Households', to: '/admin/households', icon: Building2Icon },
  { title: 'Invites', to: '/admin/invites', icon: MailIcon },
  { title: 'Users', to: '/admin/users', icon: UsersIcon },
]

function initialsFor(name: string | undefined, email: string | undefined) {
  const source = name?.trim() || email?.trim() || 'U'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function isRouteActive(pathname: string, target: string): boolean {
  if (target === '/') {
    return pathname === '/'
  }
  return pathname === target || pathname.startsWith(`${target}/`)
}

function UserIdentity({
  name,
  email,
  avatar,
  initials,
}: {
  name: string
  email: string
  avatar: string
  initials: string
}) {
  return (
    <>
      <Avatar className="size-8 rounded-lg">
        {avatar ? <AvatarImage src={avatar} alt={name} /> : null}
        <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      </div>
    </>
  )
}

function NavUser() {
  const { isMobile } = useSidebar()
  const viewer = useViewer()
  const router = useRouter()
  const { signOut, isPending } = useSignOut()

  const name = viewer.user?.name || 'Account'
  const email = viewer.user?.email || ''
  const avatar = viewer.user?.imageUrl || ''
  const initials = initialsFor(name, email)

  async function handleSignOut() {
    const ok = await signOut()
    if (!ok) {
      toast.error('Could not sign out. Please try again.')
      return
    }
    await router.navigate({ to: '/login', replace: true })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <UserIdentity
              name={name}
              email={email}
              avatar={avatar}
              initials={initials}
            />
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserIdentity
                    name={name}
                    email={email}
                    avatar={avatar}
                    initials={initials}
                  />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to="/account" />}>
                <UserCircleIcon />
                Account
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isPending}
              onClick={() => void handleSignOut()}
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const viewer = useViewer()
  const location = useLocation()
  const householdName = viewer.household?.name ?? 'No household'

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <HardDriveIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">LumaVault</span>
                <span className="truncate text-xs text-muted-foreground">
                  {householdName}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Portal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PRIMARY_NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    isActive={isRouteActive(location.pathname, item.to)}
                    tooltip={item.title}
                    render={<Link to={item.to as never} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {viewer.isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>Server Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={isRouteActive(location.pathname, item.to)}
                      tooltip={item.title}
                      render={<Link to={item.to as never} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ModeToggle />
        </div>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
