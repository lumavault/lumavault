import * as React from 'react'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { Alert, AlertDescription } from '@lumavault/ui/components/ui/alert'
import { Button } from '@lumavault/ui/components/ui/button'
import { Toaster } from '@lumavault/ui/components/ui/sonner'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { useQuery } from '@lumavault/ui/rpc'
import {
  createRootRoute,
  Outlet,
  useLocation,
  useRouter,
} from '@tanstack/react-router'
import { rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon } from 'lucide-react'

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
      void router.navigate({ to: '/setup', replace: true })
    }
  }, [needsSetup, onSetupRoute, router])

  if (setupQuery.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (setupQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>
              {rpcErrorMessage(
                setupQuery.error,
                'Could not reach the LumaVault server.',
              )}
            </AlertDescription>
          </Alert>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void setupQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
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
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">Page not found.</p>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
})
