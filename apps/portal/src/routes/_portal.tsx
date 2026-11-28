import * as React from 'react'
import { AuthGuard, useAuthConfig } from '@lumavault/ui/auth'
import { FullScreenSpinner } from '@lumavault/ui/components/ui/custom/page-states'
import {
  createFileRoute,
  Outlet,
  useLocation,
  useRouter,
} from '@tanstack/react-router'
import { PortalShell } from '#/layout/portal-shell'

function PortalLayoutRoute() {
  const router = useRouter()
  const location = useLocation()
  const { portalUrl } = useAuthConfig()

  const handleRedirect = React.useCallback(
    (url: string) => {
      try {
        const parsed = new URL(url, portalUrl)
        const portalOrigin = new URL(portalUrl).origin
        if (parsed.origin === portalOrigin) {
          void router.navigate({
            href: `${parsed.pathname}${parsed.search}${parsed.hash}`,
            replace: true,
          })
          return
        }
      } catch {
        // Fall back to browser navigation when URL parsing fails.
      }
      window.location.assign(url)
    },
    [portalUrl, router],
  )

  const currentUrl = `${portalUrl.replace(/\/+$/, '')}${location.href}`

  return (
    <AuthGuard
      allowNoHousehold
      currentUrl={currentUrl}
      onRedirect={handleRedirect}
      loadingFallback={<FullScreenSpinner />}
    >
      <PortalShell>
        <Outlet />
      </PortalShell>
    </AuthGuard>
  )
}

export const Route = createFileRoute('/_portal')({
  component: PortalLayoutRoute,
})
