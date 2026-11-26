import * as React from 'react'
import {
  isSameOriginReturnUrl,
  magicLinkSchema,
  mapAuthError,
  mapMagicLinkUrlError,
  signInPasswordSchema,
  useAuthClient,
  useAuthConfig,
  useRefreshViewer,
  validateReturnUrl,
} from '@lumavault/ui/auth'
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
import { Separator } from '@lumavault/ui/components/ui/separator'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@lumavault/ui/components/ui/tabs'
import { useViewer } from '@lumavault/ui/household'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { AuthLayout } from '#/layout/auth-layout'
import { zodFieldErrors } from '#/lib/format'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  MailIcon,
} from 'lucide-react'

interface LoginSearch {
  returnTo?: string
  error?: string
  notice?: string
}

export function navigateToReturnTarget(
  target: string,
  routerNavigate: (opts: { href: string; replace: boolean }) => Promise<void>,
  externalRedirect: (url: string) => void = (url) =>
    window.location.assign(url),
) {
  if (isSameOriginReturnUrl(target)) {
    void routerNavigate({ href: target, replace: true })
  } else {
    externalRedirect(target)
  }
}

function LoginPage() {
  const search = Route.useSearch()
  const router = useRouter()
  const viewer = useViewer()
  const authClient = useAuthClient()
  const authConfig = useAuthConfig()
  const refreshViewer = useRefreshViewer()

  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [magicEmail, setMagicEmail] = React.useState('')
  const [pwErrors, setPwErrors] = React.useState<{
    email?: string
    password?: string
  }>({})
  const [magicFieldError, setMagicFieldError] = React.useState<string | null>(
    null,
  )
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<
    'password' | 'magic-link' | 'passkey' | null
  >(null)
  const [magicLinkSent, setMagicLinkSent] = React.useState(false)

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

  const goToDestination = React.useCallback(() => {
    navigateToReturnTarget(destination, (opts) => router.navigate(opts))
  }, [destination, router])

  React.useEffect(() => {
    if (!viewer.isPending && viewer.isAuthenticated) {
      goToDestination()
    }
  }, [viewer.isPending, viewer.isAuthenticated, goToDestination])

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = signInPasswordSchema.safeParse({ email, password })
    if (!parsed.success) {
      setPwErrors(zodFieldErrors<'email' | 'password'>(parsed.error))
      return
    }
    setPwErrors({})
    setSubmitError(null)
    setPendingAction('password')
    try {
      const result = await authClient.signIn.email(parsed.data)
      if (result.error) {
        setSubmitError(mapAuthError(result.error))
        return
      }
      await refreshViewer()
      goToDestination()
    } catch (err) {
      setSubmitError(mapAuthError(err))
    } finally {
      setPendingAction(null)
    }
  }

  async function handleMagicLinkSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = magicLinkSchema.safeParse({ email: magicEmail })
    if (!parsed.success) {
      setMagicFieldError(
        parsed.error.issues[0]?.message ?? 'Enter a valid email.',
      )
      return
    }
    setMagicFieldError(null)
    setSubmitError(null)
    setMagicLinkSent(false)
    setPendingAction('magic-link')

    const portalBase = authConfig.portalUrl.replace(/\/+$/, '')
    const callbackURL = isSameOriginReturnUrl(destination)
      ? `${portalBase}${destination}`
      : destination
    const errorParams = new URLSearchParams()
    if (validatedReturn) {
      errorParams.set('returnTo', validatedReturn)
    }
    const errorQuery = errorParams.toString()
    const errorCallbackURL = `${portalBase}/login${errorQuery ? `?${errorQuery}` : ''}`

    try {
      const result = await authClient.signIn.magicLink({
        email: parsed.data.email,
        callbackURL,
        errorCallbackURL,
      })
      if (result.error) {
        setSubmitError(mapAuthError(result.error))
        return
      }
      setMagicLinkSent(true)
    } catch (err) {
      setSubmitError(mapAuthError(err))
    } finally {
      setPendingAction(null)
    }
  }

  async function handlePasskeySignIn() {
    setSubmitError(null)
    setPendingAction('passkey')
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        setSubmitError(mapAuthError(result.error))
        return
      }
      await refreshViewer()
      goToDestination()
    } catch (err) {
      setSubmitError(mapAuthError(err))
    } finally {
      setPendingAction(null)
    }
  }

  const activeError = submitError ?? urlError

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to LumaVault</CardTitle>
          <CardDescription>
            Sign in with your password, a magic link, or a passkey.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {search.notice === 'setup-complete' ? (
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>Setup complete</AlertTitle>
              <AlertDescription>
                Your server and household are ready. Sign in below to continue.
              </AlertDescription>
            </Alert>
          ) : null}

          {activeError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{activeError}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="password">
            <TabsList className="w-full">
              <TabsTrigger value="password" className="flex-1">
                Password
              </TabsTrigger>
              <TabsTrigger value="magic-link" className="flex-1">
                Magic link
              </TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="pt-4">
              <form onSubmit={(e) => void handlePasswordSubmit(e)} noValidate>
                <FieldGroup>
                  <Field data-invalid={Boolean(pwErrors.email) || undefined}>
                    <FieldLabel htmlFor="login-email">Email</FieldLabel>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={Boolean(pwErrors.email) || undefined}
                      disabled={pendingAction !== null}
                    />
                    {pwErrors.email ? (
                      <FieldError>{pwErrors.email}</FieldError>
                    ) : null}
                  </Field>

                  <Field data-invalid={Boolean(pwErrors.password) || undefined}>
                    <FieldLabel htmlFor="login-password">Password</FieldLabel>
                    <PasswordInput
                      id="login-password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={Boolean(pwErrors.password) || undefined}
                      disabled={pendingAction !== null}
                    />
                    {pwErrors.password ? (
                      <FieldError>{pwErrors.password}</FieldError>
                    ) : null}
                  </Field>

                  <Button
                    type="submit"
                    disabled={pendingAction !== null}
                    className="w-full"
                  >
                    {pendingAction === 'password' ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    Sign in
                  </Button>
                </FieldGroup>
              </form>
            </TabsContent>

            <TabsContent value="magic-link" className="pt-4">
              {magicLinkSent ? (
                <div className="flex flex-col gap-3">
                  <Alert>
                    <MailIcon />
                    <AlertTitle>Check your email</AlertTitle>
                    <AlertDescription>
                      We sent a one-time sign-in link to {magicEmail}. Open it
                      on this device to sign in.
                    </AlertDescription>
                  </Alert>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMagicLinkSent(false)
                      setSubmitError(null)
                    }}
                  >
                    Use a different email
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => void handleMagicLinkSubmit(e)}
                  noValidate
                >
                  <FieldGroup>
                    <Field data-invalid={Boolean(magicFieldError) || undefined}>
                      <FieldLabel htmlFor="magic-email">Email</FieldLabel>
                      <Input
                        id="magic-email"
                        type="email"
                        autoComplete="email"
                        value={magicEmail}
                        onChange={(e) => setMagicEmail(e.target.value)}
                        aria-invalid={Boolean(magicFieldError) || undefined}
                        disabled={pendingAction !== null}
                      />
                      {magicFieldError ? (
                        <FieldError>{magicFieldError}</FieldError>
                      ) : null}
                    </Field>

                    <Button
                      type="submit"
                      disabled={pendingAction !== null}
                      className="w-full"
                    >
                      {pendingAction === 'magic-link' ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <MailIcon data-icon="inline-start" />
                      )}
                      Send sign-in link
                    </Button>
                  </FieldGroup>
                </form>
              )}
            </TabsContent>
          </Tabs>

          <div className="relative flex items-center py-1">
            <Separator className="flex-1" />
            <span className="px-2 text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pendingAction !== null}
            onClick={() => void handlePasskeySignIn()}
          >
            {pendingAction === 'passkey' ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <KeyRoundIcon data-icon="inline-start" />
            )}
            Sign in with a passkey
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
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
