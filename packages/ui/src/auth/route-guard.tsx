import * as React from 'react'
import { Button } from '#components/ui/button'
import { useViewer } from '#household'

import { useAuthConfig } from './client'
import { buildPortalLoginUrl, validateReturnUrl } from './return-url'

interface AuthGuardProps {
  allowNoHousehold?: boolean
  requireSuperAdmin?: boolean
  currentUrl?: string
  onRedirect?: (url: string) => void
  loadingFallback?: React.ReactNode
  forbiddenFallback?: React.ReactNode
  children: React.ReactNode
}

function defaultRedirect(url: string) {
  window.location.assign(url)
}

export function AuthGuard({
  allowNoHousehold = false,
  requireSuperAdmin = false,
  currentUrl,
  onRedirect = defaultRedirect,
  loadingFallback = null,
  forbiddenFallback,
  children,
}: AuthGuardProps) {
  const viewer = useViewer()
  const config = useAuthConfig()
  // Kept in a ref so an inline callback from the caller does not re-run the redirect effect.
  const onRedirectRef = React.useRef(onRedirect)
  onRedirectRef.current = onRedirect

  const shouldRedirectToLogin =
    !viewer.isPending && !viewer.error && !viewer.isAuthenticated
  const shouldRedirectNoHousehold =
    !viewer.isPending &&
    viewer.isAuthenticated &&
    !viewer.hasHousehold &&
    !allowNoHousehold
  const shouldRedirectForbidden =
    !viewer.isPending &&
    viewer.isAuthenticated &&
    requireSuperAdmin &&
    !viewer.isSuperAdmin &&
    forbiddenFallback === undefined

  React.useEffect(() => {
    if (shouldRedirectToLogin) {
      const target =
        currentUrl ??
        (typeof window !== 'undefined' ? window.location.href : undefined)
      const safeReturn = validateReturnUrl(target, {
        portalOrigin: config.portalUrl,
        allowedOrigins: config.allowedOrigins,
      })
      onRedirectRef.current(buildPortalLoginUrl(config.portalUrl, safeReturn))
      return
    }

    if (shouldRedirectNoHousehold || shouldRedirectForbidden) {
      onRedirectRef.current(`${config.portalUrl.replace(/\/+$/, '')}/`)
    }
  }, [
    shouldRedirectToLogin,
    shouldRedirectNoHousehold,
    shouldRedirectForbidden,
    currentUrl,
    config.portalUrl,
    config.allowedOrigins,
  ])

  if (viewer.isPending) {
    return <>{loadingFallback}</>
  }

  if (viewer.error) {
    return (
      <div
        role="alert"
        className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm"
      >
        <p className="text-destructive">
          {viewer.error.rawMessage ||
            'Could not reach the server. Please try again.'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void viewer.refetch()}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (!viewer.isAuthenticated) {
    return null
  }

  if (requireSuperAdmin && !viewer.isSuperAdmin) {
    return forbiddenFallback !== undefined ? <>{forbiddenFallback}</> : null
  }

  if (!viewer.hasHousehold && !allowNoHousehold) {
    return null
  }

  return <>{children}</>
}
