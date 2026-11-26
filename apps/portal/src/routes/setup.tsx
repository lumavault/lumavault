import * as React from 'react'
import { createClient } from '@connectrpc/connect'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { emailSchema, passwordSchema } from '@lumavault/ui/auth'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@lumavault/ui/components/ui/alert'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import { PasswordInput } from '@lumavault/ui/components/ui/custom/inputs/password-input'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { viewerQueryKey } from '@lumavault/ui/household'
import {
  createConnectQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
  useTransport,
} from '@lumavault/ui/rpc'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { AuthLayout } from '#/layout/auth-layout'
import { rpcErrorMessage, zodFieldErrors } from '#/lib/format'
import { AlertCircleIcon, InfoIcon } from 'lucide-react'
import { z } from 'zod'

const setupSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name.'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    householdName: z.string().trim().min(1, 'Enter a name for your household.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

type SetupFieldErrors = Partial<
  Record<keyof z.infer<typeof setupSchema>, string>
>

function SetupPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const transport = useTransport()
  const setupQuery = useQuery(IamService.method.getSetupStatus)
  const completeSetup = useMutation(IamService.method.completeSetup)

  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [householdName, setHouseholdName] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<SetupFieldErrors>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [isFinishing, setIsFinishing] = React.useState(false)

  const alreadySetUp =
    !setupQuery.isPending && setupQuery.data?.needsSetup === false

  React.useEffect(() => {
    if (alreadySetUp && !isFinishing) {
      void router.navigate({ to: '/', replace: true })
    }
  }, [alreadySetUp, isFinishing, router])

  if (setupQuery.isPending || (alreadySetUp && !isFinishing)) {
    return (
      <AuthLayout>
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      </AuthLayout>
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitError(null)

    const parsed = setupSchema.safeParse({
      name,
      email,
      password,
      confirmPassword,
      householdName,
    })

    if (!parsed.success) {
      setFieldErrors(
        zodFieldErrors<keyof z.infer<typeof setupSchema>>(parsed.error),
      )
      return
    }

    setFieldErrors({})
    setIsFinishing(true)

    try {
      await completeSetup.mutateAsync({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        householdName: parsed.data.householdName,
      })

      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: IamService.method.getSetupStatus,
          cardinality: 'finite',
        }),
      })

      // Verify whether CompleteSetup's best-effort sign-in established a session cookie.
      const iamClient = createClient(IamService, transport)
      let signedIn = false
      try {
        const viewerRes = await iamClient.getViewer({})
        signedIn = Boolean(viewerRes.user)
        await queryClient.invalidateQueries({ queryKey: viewerQueryKey() })
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

  const busy = completeSetup.isPending || isFinishing

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Set up LumaVault</CardTitle>
          <CardDescription>
            Create the first Super-Admin account and your initial household.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {setupQuery.data?.adminEmailRequired ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Admin email required</AlertTitle>
              <AlertDescription>
                This server is configured to accept only its preset admin email
                address during setup.
              </AlertDescription>
            </Alert>
          ) : null}

          {submitError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(fieldErrors.name) || undefined}>
                <FieldLabel htmlFor="setup-name">Your name</FieldLabel>
                <Input
                  id="setup-name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.name) || undefined}
                  disabled={busy}
                />
                {fieldErrors.name ? (
                  <FieldError>{fieldErrors.name}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={Boolean(fieldErrors.email) || undefined}>
                <FieldLabel htmlFor="setup-email">Email</FieldLabel>
                <Input
                  id="setup-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.email) || undefined}
                  disabled={busy}
                />
                {fieldErrors.email ? (
                  <FieldError>{fieldErrors.email}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={Boolean(fieldErrors.password) || undefined}>
                <FieldLabel htmlFor="setup-password">Password</FieldLabel>
                <PasswordInput
                  id="setup-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.password) || undefined}
                  disabled={busy}
                />
                {fieldErrors.password ? (
                  <FieldError>{fieldErrors.password}</FieldError>
                ) : null}
              </Field>

              <Field
                data-invalid={Boolean(fieldErrors.confirmPassword) || undefined}
              >
                <FieldLabel htmlFor="setup-confirm-password">
                  Confirm password
                </FieldLabel>
                <PasswordInput
                  id="setup-confirm-password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={
                    Boolean(fieldErrors.confirmPassword) || undefined
                  }
                  disabled={busy}
                />
                {fieldErrors.confirmPassword ? (
                  <FieldError>{fieldErrors.confirmPassword}</FieldError>
                ) : null}
              </Field>

              <Field
                data-invalid={Boolean(fieldErrors.householdName) || undefined}
              >
                <FieldLabel htmlFor="setup-household">
                  Household name
                </FieldLabel>
                <Input
                  id="setup-household"
                  placeholder="For example, Agrawal Home"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.householdName) || undefined}
                  disabled={busy}
                />
                {fieldErrors.householdName ? (
                  <FieldError>{fieldErrors.householdName}</FieldError>
                ) : null}
              </Field>

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Complete setup
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}

export const Route = createFileRoute('/setup')({
  component: SetupPage,
})
