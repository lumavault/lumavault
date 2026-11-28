import * as React from 'react'
import type { Transport } from '@connectrpc/connect'
import { AuthProvider, type AuthClient } from '@lumavault/ui/auth'
import { ThemeProvider } from '@lumavault/ui/components/theme-provider'
import { RpcProvider } from '@lumavault/ui/rpc'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRouter,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router'
import { portalConfig } from '#/config'
import { routeTree } from '#/routeTree.gen'

export function createPortalRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createPortalRouter>
  }
}

export interface PortalAppProps {
  transport?: Transport
  queryClient?: QueryClient
  authClient?: AuthClient
  router?: ReturnType<typeof createPortalRouter>
}

export function PortalApp({
  transport,
  queryClient,
  authClient,
  router,
}: PortalAppProps) {
  const [resolvedRouter] = React.useState(() => router ?? createPortalRouter())

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <RpcProvider
        apiUrl={portalConfig.apiUrl}
        transport={transport}
        queryClient={queryClient}
      >
        <AuthProvider
          apiUrl={portalConfig.apiUrl}
          portalUrl={portalConfig.portalUrl}
          allowedOrigins={portalConfig.allowedOrigins}
          authClient={authClient}
        >
          <RouterProvider router={resolvedRouter} />
        </AuthProvider>
      </RpcProvider>
    </ThemeProvider>
  )
}
