import * as React from 'react'
import { useViewer } from '#household'

import { useAuthConfig } from './client'
import { buildPortalLoginUrl, validateReturnUrl } from './return-url'

export interface AuthGuardProps {
  allowNoHousehold?: boolean
  requireSuperAdmin?: boolean
  currentUrl?: string
  onRedirect?: (url: string) => void
  loadingFallback?: React.ReactNode
  noHouseholdFallback?: React.ReactNode
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
  noHouseholdFallback,
  forbiddenFallback,
  children,
}: AuthGuardProps) {
  const viewer = useViewer()
  const config = useAuthConfig()

  const shouldRedirectToLogin = !viewer.isPending && !viewer.isAuthenticated
  const shouldRedirectNoHousehold =
    !viewer.isPending &&
    viewer.isAuthenticated &&
    !viewer.hasHousehold &&
    !allowNoHousehold &&
    noHouseholdFallback === undefined
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
      onRedirect(buildPortalLoginUrl(config.portalUrl, safeReturn))
      return
    }

    if (shouldRedirectNoHousehold || shouldRedirectForbidden) {
      onRedirect(`${config.portalUrl.replace(/\/+$/, '')}/`)
    }
  }, [
    shouldRedirectToLogin,
    shouldRedirectNoHousehold,
    shouldRedirectForbidden,
    currentUrl,
    config.portalUrl,
    config.allowedOrigins,
    onRedirect,
  ])

  if (viewer.isPending) {
    return <>{loadingFallback}</>
  }

  if (!viewer.isAuthenticated) {
    return null
  }

  if (requireSuperAdmin && !viewer.isSuperAdmin) {
    return forbiddenFallback !== undefined ? <>{forbiddenFallback}</> : null
  }

  if (!viewer.hasHousehold && !allowNoHousehold) {
    return noHouseholdFallback !== undefined ? <>{noHouseholdFallback}</> : null
  }

  return <>{children}</>
}
