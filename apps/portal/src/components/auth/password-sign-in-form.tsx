import * as React from 'react'
import { signInPasswordSchema } from '@lumavault/ui/auth'
import { FormField } from '@lumavault/ui/components/ui/custom/form-field'
import { PasswordInput } from '@lumavault/ui/components/ui/custom/inputs/password-input'
import { LoadingButton } from '@lumavault/ui/components/ui/custom/loading-button'
import { FieldGroup } from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import { zodFieldErrors } from '#/lib/format'

export interface PasswordSignInValues {
  email: string
  password: string
}

export interface PasswordSignInFormProps {
  disabled?: boolean
  isSubmitting?: boolean
  submitLabel?: string
  idPrefix?: string
  onSubmit: (values: PasswordSignInValues) => Promise<void> | void
}

export function PasswordSignInForm({
  disabled = false,
  isSubmitting = false,
  submitLabel = 'Sign in',
  idPrefix = 'login',
  onSubmit,
}: PasswordSignInFormProps) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    email?: string
    password?: string
  }>({})

  const emailId = `${idPrefix}-email`
  const passwordId = `${idPrefix}-password`

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = signInPasswordSchema.safeParse({ email, password })
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors<'email' | 'password'>(parsed.error))
      return
    }
    setFieldErrors({})
    await onSubmit(parsed.data)
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      <FieldGroup>
        <FormField id={emailId} label="Email" error={fieldErrors.email}>
          <Input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email) || undefined}
            disabled={disabled || isSubmitting}
          />
        </FormField>

        <FormField
          id={passwordId}
          label="Password"
          error={fieldErrors.password}
        >
          <PasswordInput
            id={passwordId}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.password) || undefined}
            disabled={disabled || isSubmitting}
          />
        </FormField>

        <LoadingButton
          type="submit"
          loading={isSubmitting}
          disabled={disabled}
          className="w-full"
        >
          {submitLabel}
        </LoadingButton>
      </FieldGroup>
    </form>
  )
}
