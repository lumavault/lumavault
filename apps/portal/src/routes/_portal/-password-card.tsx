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
import { useMutation, useQuery } from '@tanstack/react-query'
import { zodFieldErrors } from '#/lib/format'
import { AlertCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import { unwrap } from './-auth-result'

const LINKED_ACCOUNTS_QUERY_KEY = ['auth', 'linked-accounts'] as const

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmPassword'

export function PasswordCard() {
  const authClient = useAuthClient()
  const linkedAccountsQuery = useQuery({
    queryKey: LINKED_ACCOUNTS_QUERY_KEY,
    retry: false,
    queryFn: async () => unwrap(await authClient.listAccounts()) ?? [],
  })

  const changePasswordMutation = useMutation({
    mutationFn: async (input: {
      currentPassword: string
      newPassword: string
    }) =>
      unwrap(
        await authClient.changePassword({
          ...input,
          revokeOtherSessions: true,
        }),
      ),
  })

  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [pwErrors, setPwErrors] = React.useState<
    Partial<Record<PasswordField, string>>
  >({})

  const isChangingPassword = changePasswordMutation.isPending
  const hasCredentialAccount = (linkedAccountsQuery.data ?? []).some(
    (account) => account.providerId === 'credential',
  )

  function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    })
    if (!parsed.success) {
      changePasswordMutation.reset()
      setPwErrors(zodFieldErrors<PasswordField>(parsed.error))
      return
    }
    setPwErrors({})
    changePasswordMutation.mutate(
      {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
      {
        onSuccess: () => {
          setCurrentPassword('')
          setNewPassword('')
          setConfirmPassword('')
          toast.success('Password updated. Other devices were signed out.')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Update the password for your account. Other devices will be signed
          out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {linkedAccountsQuery.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : linkedAccountsQuery.error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>
              {mapAuthError(linkedAccountsQuery.error)}
            </AlertDescription>
          </Alert>
        ) : !hasCredentialAccount ? (
          <p className="text-sm text-muted-foreground">
            This account signs in with magic links or passkeys and does not have
            a password set.
          </p>
        ) : (
          <form
            onSubmit={handlePasswordSubmit}
            noValidate
            className="flex flex-col gap-4"
          >
            {changePasswordMutation.error ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>
                  {mapAuthError(changePasswordMutation.error)}
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
