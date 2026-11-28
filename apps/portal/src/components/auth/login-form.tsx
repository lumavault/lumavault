import * as React from 'react'
import {
  buildPortalLoginUrl,
  isSameOriginReturnUrl,
  mapAuthError,
  useAuthClient,
  useAuthConfig,
  useRefreshViewer,
} from '@lumavault/ui/auth'
import { LoadingButton } from '@lumavault/ui/components/ui/custom/loading-button'
import { StatusAlert } from '@lumavault/ui/components/ui/custom/status-alert'
import { Separator } from '@lumavault/ui/components/ui/separator'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@lumavault/ui/components/ui/tabs'
import { CheckCircle2Icon, KeyRoundIcon } from 'lucide-react'

import { MagicLinkForm } from './magic-link-form'
import {
  PasswordSignInForm,
  type PasswordSignInValues,
} from './password-sign-in-form'

export interface LoginFormProps {
  destination: string
  validatedReturn: string | null
  urlError?: string | null
  notice?: string
}

export function LoginForm({
  destination,
  validatedReturn,
  urlError,
  notice,
}: LoginFormProps) {
  const authClient = useAuthClient()
  const authConfig = useAuthConfig()
  const refreshViewer = useRefreshViewer()

  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<
    'password' | 'magic-link' | 'passkey' | null
  >(null)
  const [magicLinkSent, setMagicLinkSent] = React.useState(false)

  async function handlePasswordSubmit(values: PasswordSignInValues) {
    setSubmitError(null)
    setPendingAction('password')
    try {
      const result = await authClient.signIn.email(values)
      if (result.error) {
        setSubmitError(mapAuthError(result.error))
        return
      }
      await refreshViewer()
    } catch (err) {
      setSubmitError(mapAuthError(err))
    } finally {
      setPendingAction(null)
    }
  }

  async function handleMagicLinkSubmit(email: string) {
    setSubmitError(null)
    setMagicLinkSent(false)
    setPendingAction('magic-link')

    const portalBase = authConfig.portalUrl.replace(/\/+$/, '')
    const callbackURL = isSameOriginReturnUrl(destination)
      ? `${portalBase}${destination}`
      : destination
    const errorCallbackURL = buildPortalLoginUrl(
      authConfig.portalUrl,
      validatedReturn,
    )

    try {
      const result = await authClient.signIn.magicLink({
        email,
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
    } catch (err) {
      setSubmitError(mapAuthError(err))
    } finally {
      setPendingAction(null)
    }
  }

  const activeError =
    submitError ?? (pendingAction || magicLinkSent ? null : urlError)

  return (
    <>
      {notice === 'setup-complete' ? (
        <StatusAlert
          icon={<CheckCircle2Icon />}
          title="Setup complete"
          description="Your server and household are ready. Sign in below to continue."
        />
      ) : null}

      {activeError ? (
        <StatusAlert variant="destructive" description={activeError} />
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
          <PasswordSignInForm
            disabled={pendingAction !== null}
            isSubmitting={pendingAction === 'password'}
            onSubmit={handlePasswordSubmit}
          />
        </TabsContent>

        <TabsContent value="magic-link" className="pt-4">
          <MagicLinkForm
            disabled={pendingAction !== null}
            isSubmitting={pendingAction === 'magic-link'}
            sent={magicLinkSent}
            onSubmit={handleMagicLinkSubmit}
            onReset={() => {
              setMagicLinkSent(false)
              setSubmitError(null)
            }}
          />
        </TabsContent>
      </Tabs>

      <div className="relative flex items-center py-1">
        <Separator className="flex-1" />
        <span className="px-2 text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <LoadingButton
        type="button"
        variant="outline"
        className="w-full"
        loading={pendingAction === 'passkey'}
        disabled={pendingAction !== null}
        icon={<KeyRoundIcon data-icon="inline-start" />}
        onClick={() => void handlePasskeySignIn()}
      >
        Sign in with a passkey
      </LoadingButton>
    </>
  )
}
