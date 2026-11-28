import * as React from 'react'
import {
  isSameOriginReturnUrl,
  mapMagicLinkUrlError,
  useAuthConfig,
  validateReturnUrl,
} from '@lumavault/ui/auth'
import { useViewer } from '@lumavault/ui/household'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { AuthCard } from '#/components/auth/auth-card'
import { LoginForm } from '#/components/auth/login-form'

interface LoginSearch {
  returnTo?: string
  error?: string
  notice?: string
}

function LoginPage() {
  const search = Route.useSearch()
  const router = useRouter()
  const viewer = useViewer()
  const authConfig = useAuthConfig()

  const validatedReturn = React.useMemo(
    () =>
      validateReturnUrl(search.returnTo, {
        portalOrigin: authConfig.portalUrl,
        allowedOrigins: authConfig.allowedOrigins,
      }),
    [search.returnTo, authConfig.portalUrl, authConfig.allowedOrigins],
  )
  const destination = validatedReturn ?? '/'
  const urlError = mapMagicLinkUrlError(search.error)

  React.useEffect(() => {
    if (viewer.isPending || !viewer.isAuthenticated) {
      return
    }
    if (isSameOriginReturnUrl(destination)) {
      void router.navigate({ href: destination, replace: true })
    } else {
      window.location.assign(destination)
    }
  }, [viewer.isPending, viewer.isAuthenticated, destination, router])

  return (
    <AuthCard
      title="Sign in to LumaVault"
      description="Sign in with your password, a magic link, or a passkey."
    >
      <LoginForm
        destination={destination}
        validatedReturn={validatedReturn}
        urlError={urlError}
        notice={search.notice}
      />
    </AuthCard>
  )
}

export const Route = createFileRoute('/login/')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    notice: typeof search.notice === 'string' ? search.notice : undefined,
  }),
  component: LoginPage,
})
