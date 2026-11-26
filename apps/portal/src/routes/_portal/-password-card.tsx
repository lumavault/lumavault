import * as React from 'react'
import {
  changePasswordSchema,
  mapAuthError,
  useAuthClient,
} from '@lumavault/ui/auth'
import { Alert, AlertDescription } from '@lumavault/ui/components/ui/alert'
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
import { Skeleton } from '@lumavault/ui/components/ui/skeleton'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { zodFieldErrors } from '#/lib/format'
import { AlertCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

const LINKED_ACCOUNTS_QUERY_KEY = ['auth', 'linked-accounts'] as const

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmPassword'

export function PasswordCard() {
  const authClient = useAuthClient()
  const linkedAccountsQuery = useQuery({
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    retry: false,
    queryFn: async () => {
      const res = await authClient.listAccounts()
      if (res?.error) {
        throw new Error(mapAuthError(res.error))
      }
      return res?.data ?? []
    },
  })

  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [pwErrors, setPwErrors] = React.useState<
    Partial<Record<PasswordField, string>>
  >({})
  const [pwActionError, setPwActionError] = React.useState<string | null>(null)
  const [isChangingPassword, setIsChangingPassword] = React.useState(false)
  const [pwSuccess, setPwSuccess] = React.useState(false)

  const hasCredentialAccount = (linkedAccountsQuery.data ?? []).some(
    (account) => account.providerId === 'credential',
  )

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPwSuccess(false)
    setPwActionError(null)
    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    })
    if (!parsed.success) {
      setPwErrors(zodFieldErrors<PasswordField>(parsed.error))
      return
    }
    setPwErrors({})
    setIsChangingPassword(true)
    try {
      const res = await authClient.changePassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: false,
      })
      if (res?.error) {
        setPwActionError(mapAuthError(res.error))
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPwSuccess(true)
      toast.success('Password updated.')
    } catch (err) {
      setPwActionError(mapAuthError(err))
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Update the password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {linkedAccountsQuery.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : linkedAccountsQuery.error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>
              {linkedAccountsQuery.error.message}
            </AlertDescription>
          </Alert>
        ) : !hasCredentialAccount ? (
          <p className="text-sm text-muted-foreground">
            This account signs in with magic links or passkeys and does not have
            a password set.
          </p>
        ) : (
          <form
            onSubmit={(e) => void handlePasswordSubmit(e)}
            noValidate
            className="flex flex-col gap-4"
          >
            {pwActionError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{pwActionError}</AlertDescription>
              </Alert>
            ) : null}

            {pwSuccess ? (
              <Alert>
                <AlertDescription>
                  Your password has been updated.
                </AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <Field
                data-invalid={Boolean(pwErrors.currentPassword) || undefined}
              >
                <FieldLabel htmlFor="current-password">
                  Current password
                </FieldLabel>
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  aria-invalid={Boolean(pwErrors.currentPassword) || undefined}
                  disabled={isChangingPassword}
                />
                {pwErrors.currentPassword ? (
                  <FieldError>{pwErrors.currentPassword}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={Boolean(pwErrors.newPassword) || undefined}>
                <FieldLabel htmlFor="new-password">New password</FieldLabel>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-invalid={Boolean(pwErrors.newPassword) || undefined}
                  disabled={isChangingPassword}
                />
                {pwErrors.newPassword ? (
                  <FieldError>{pwErrors.newPassword}</FieldError>
                ) : null}
              </Field>

              <Field
                data-invalid={Boolean(pwErrors.confirmPassword) || undefined}
              >
                <FieldLabel htmlFor="confirm-new-password">
                  Confirm new password
                </FieldLabel>
                <PasswordInput
                  id="confirm-new-password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(pwErrors.confirmPassword) || undefined}
                  disabled={isChangingPassword}
                />
                {pwErrors.confirmPassword ? (
                  <FieldError>{pwErrors.confirmPassword}</FieldError>
                ) : null}
              </Field>

              <div>
                <Button type="submit" disabled={isChangingPassword}>
                  {isChangingPassword ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Update password
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
