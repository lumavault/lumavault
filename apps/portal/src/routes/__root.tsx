import * as React from 'react'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import {
  FullScreenError,
  FullScreenMessage,
  FullScreenSpinner,
} from '@lumavault/ui/components/ui/custom/page-states'
import { Toaster } from '@lumavault/ui/components/ui/sonner'
import { useQuery } from '@lumavault/ui/rpc'
import {
  createRootRoute,
  Outlet,
  useLocation,
  useRouter,
} from '@tanstack/react-router'
import { rpcErrorMessage } from '#/lib/format'

function RootComponent() {
  const location = useLocation()
  const router = useRouter()
  const setupQuery = useQuery(IamService.method.getSetupStatus, undefined, {
    retry: false,
  })

  const needsSetup = setupQuery.data?.needsSetup === true
  const onSetupRoute =
    location.pathname === '/setup' || location.pathname.startsWith('/setup/')

  React.useEffect(() => {
    if (needsSetup && !onSetupRoute) {
      void router.navigate({ to: '/setup' as never, replace: true })
    }
  }, [needsSetup, onSetupRoute, router])

  if (setupQuery.isPending) {
    return <FullScreenSpinner />
  }

  if (setupQuery.isError) {
    return (
      <FullScreenError
        message={rpcErrorMessage(
          setupQuery.error,
          'Could not reach the LumaVault server.',
        )}
        onRetry={() => void setupQuery.refetch()}
      />
    )
  }

  if (needsSetup && !onSetupRoute) {
    return null
  }

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}

function NotFoundPage() {
  return <FullScreenMessage>Page not found.</FullScreenMessage>
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
})
