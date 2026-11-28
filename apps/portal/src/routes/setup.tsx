import * as React from 'react'
import { createQueryOptions } from '@connectrpc/connect-query'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { FullScreenSpinner } from '@lumavault/ui/components/ui/custom/page-states'
import {
  createConnectQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
  useTransport,
} from '@lumavault/ui/rpc'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { AuthCard } from '#/components/auth/auth-card'
import { SetupForm, type SetupFormValues } from '#/components/auth/setup-form'
import { rpcErrorMessage } from '#/lib/format'

function SetupPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const transport = useTransport()
  const setupQuery = useQuery(IamService.method.getSetupStatus)
  const completeSetup = useMutation(IamService.method.completeSetup)

  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [isFinishing, setIsFinishing] = React.useState(false)

  const alreadySetUp = setupQuery.data?.needsSetup === false

  React.useEffect(() => {
    if (alreadySetUp && !isFinishing) {
      void router.navigate({ to: '/', replace: true })
    }
  }, [alreadySetUp, isFinishing, router])

  if (alreadySetUp && !isFinishing) {
    return <FullScreenSpinner />
  }

  async function handleSubmit(values: SetupFormValues) {
    setSubmitError(null)
    setIsFinishing(true)

    try {
      await completeSetup.mutateAsync(values)

      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: IamService.method.getSetupStatus,
          cardinality: 'finite',
        }),
      })

      // Verify whether CompleteSetup's best-effort sign-in established a session cookie.
      let signedIn = false
      try {
        const viewer = await queryClient.fetchQuery(
          createQueryOptions(IamService.method.getViewer, undefined, {
            transport,
          }),
        )
        signedIn = Boolean(viewer.user)
      } catch {
        signedIn = false
      }

      if (signedIn) {
        await router.navigate({ to: '/', replace: true })
      } else {
        await router.navigate({
          to: '/login',
          search: { notice: 'setup-complete' },
          replace: true,
        })
      }
    } catch (err) {
      setIsFinishing(false)
      setSubmitError(
        rpcErrorMessage(err, 'Could not finish setup. Please try again.'),
      )
    }
  }

  return (
    <AuthCard
      title="Set up LumaVault"
      description="Create the first Super-Admin account and your initial household."
    >
      <SetupForm
        adminEmailRequired={setupQuery.data?.adminEmailRequired}
        isSubmitting={isFinishing}
        error={submitError}
        onSubmit={handleSubmit}
      />
    </AuthCard>
  )
}

export const Route = createFileRoute('/setup')({
  component: SetupPage,
})
