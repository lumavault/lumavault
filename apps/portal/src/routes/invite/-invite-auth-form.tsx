import * as React from 'react'
import {
  mapAuthError,
  signUpPasswordSchema,
  useAuthClient,
  useAuthConfig,
  useRefreshViewer,
} from '@lumavault/ui/auth'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@lumavault/ui/components/ui/alert'
import { Button } from '@lumavault/ui/components/ui/button'
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
import { Link, useRouter } from '@tanstack/react-router'
import { zodFieldErrors } from '#/lib/format'
import { AlertCircleIcon, MailIcon } from 'lucide-react'

export interface InviteAuthFormProps {
  email: string
  invitePath: string
  isNewHousehold: boolean
}

export function InviteAuthForm({
  email,
  invitePath,
  isNewHousehold,
}: InviteAuthFormProps) {
  const router = useRouter()
  const authClient = useAuthClient()
  const authConfig = useAuthConfig()
  const refreshViewer = useRefreshViewer()

  const [name, setName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    name?: string
    password?: string
  }>({})
  const [authError, setAuthError] = React.useState<string | null>(null)
  const [authPending, setAuthPending] = React.useState<
    'password' | 'magic-link' | null
  >(null)
  const [magicLinkSent, setMagicLinkSent] = React.useState(false)

  async function handlePasswordSignUp(event: React.FormEvent) {
    event.preventDefault()
    const parsed = signUpPasswordSchema.safeParse({ name, email, password })
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors<'name' | 'password'>(parsed.error))
      return
    }
    setFieldErrors({})
    setAuthError(null)
    setAuthPending('password')
    try {
      const result = await authClient.signUp.email(parsed.data)
      if (result.error) {
        setAuthError(mapAuthError(result.error))
        return
      }
      await refreshViewer()
      if (!isNewHousehold) {
        // Sign-up joins the newest pending member invite for this email, which may not be this link.
        await router.navigate({ to: '/', replace: true })
      }
    } catch (err) {
      setAuthError(mapAuthError(err))
    } finally {
      setAuthPending(null)
    }
  }

  async function handleMagicLinkSignUp(event: React.FormEvent) {
    event.preventDefault()
    setAuthError(null)
    setMagicLinkSent(false)
    setAuthPending('magic-link')
    const portalBase = authConfig.portalUrl.replace(/\/+$/, '')
    const inviteFullUrl = `${portalBase}${invitePath}`
    try {
      const result = await authClient.signIn.magicLink({
        email,
        name: name.trim() || undefined,
        callbackURL: inviteFullUrl,
        newUserCallbackURL: isNewHousehold ? inviteFullUrl : `${portalBase}/`,
        errorCallbackURL: inviteFullUrl,
      })
      if (result.error) {
        setAuthError(mapAuthError(result.error))
        return
      }
      setMagicLinkSent(true)
    } catch (err) {
      setAuthError(mapAuthError(err))
    } finally {
      setAuthPending(null)
    }
  }

  return (
    <>
      {authError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invite-email">Email</FieldLabel>
          <Input id="invite-email" type="email" value={email} disabled />
        </Field>

        <Field data-invalid={Boolean(fieldErrors.name) || undefined}>
          <FieldLabel htmlFor="invite-name">Your name</FieldLabel>
          <Input
            id="invite-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name) || undefined}
            disabled={authPending !== null}
          />
          {fieldErrors.name ? (
            <FieldError>{fieldErrors.name}</FieldError>
          ) : null}
        </Field>
      </FieldGroup>

      <Tabs defaultValue="password">
        <TabsList className="w-full">
          <TabsTrigger value="password" className="flex-1">
            Create password
          </TabsTrigger>
          <TabsTrigger value="magic-link" className="flex-1">
            Magic link
          </TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="pt-4">
          <form onSubmit={(e) => void handlePasswordSignUp(e)} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(fieldErrors.password) || undefined}>
                <FieldLabel htmlFor="invite-password">Password</FieldLabel>
                <PasswordInput
                  id="invite-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.password) || undefined}
                  disabled={authPending !== null}
                />
                {fieldErrors.password ? (
                  <FieldError>{fieldErrors.password}</FieldError>
                ) : null}
              </Field>

              <Button
                type="submit"
                disabled={authPending !== null}
                className="w-full"
              >
                {authPending === 'password' ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Create account and continue
              </Button>
            </FieldGroup>
          </form>
        </TabsContent>

        <TabsContent value="magic-link" className="pt-4">
          {magicLinkSent ? (
            <Alert>
              <MailIcon />
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>
                We sent a sign-in link to {email}. Open it to finish accepting
                your invite.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={(e) => void handleMagicLinkSignUp(e)} noValidate>
              <FieldGroup>
                <Button
                  type="submit"
                  disabled={authPending !== null}
                  className="w-full"
                >
                  {authPending === 'magic-link' ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <MailIcon data-icon="inline-start" />
                  )}
                  Send invite sign-in link
                </Button>
              </FieldGroup>
            </form>
          )}
        </TabsContent>
      </Tabs>

      <Separator />

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Already have an account?</span>
        <Link
          to="/login"
          search={{ returnTo: invitePath }}
          className="font-medium text-primary underline underline-offset-4"
        >
          Sign in to accept
        </Link>
      </div>
    </>
  )
}
