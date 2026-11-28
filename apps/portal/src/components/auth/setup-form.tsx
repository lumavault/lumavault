import * as React from 'react'
import { signUpPasswordSchema } from '@lumavault/ui/auth'
import { FormField } from '@lumavault/ui/components/ui/custom/form-field'
import { PasswordInput } from '@lumavault/ui/components/ui/custom/inputs/password-input'
import { LoadingButton } from '@lumavault/ui/components/ui/custom/loading-button'
import { StatusAlert } from '@lumavault/ui/components/ui/custom/status-alert'
import { FieldGroup } from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import { zodFieldErrors } from '#/lib/format'
import { InfoIcon } from 'lucide-react'
import { z } from 'zod'

const setupSchema = signUpPasswordSchema
  .extend({
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

export interface SetupFormValues {
  name: string
  email: string
  password: string
  householdName: string
}

export interface SetupFormProps {
  adminEmailRequired?: boolean
  isSubmitting: boolean
  error: string | null
  onSubmit: (values: SetupFormValues) => Promise<void> | void
}

export function SetupForm({
  adminEmailRequired = false,
  isSubmitting,
  error,
  onSubmit,
}: SetupFormProps) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [householdName, setHouseholdName] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<SetupFieldErrors>({})

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

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
    await onSubmit({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      householdName: parsed.data.householdName,
    })
  }

  return (
    <>
      {adminEmailRequired ? (
        <StatusAlert
          icon={<InfoIcon />}
          title="Admin email required"
          description="This server is configured to accept only its preset admin email address during setup."
        />
      ) : null}

      {error ? <StatusAlert variant="destructive" description={error} /> : null}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <FieldGroup>
          <FormField id="setup-name" label="Your name" error={fieldErrors.name}>
            <Input
              id="setup-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name) || undefined}
              disabled={isSubmitting}
            />
          </FormField>

          <FormField id="setup-email" label="Email" error={fieldErrors.email}>
            <Input
              id="setup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email) || undefined}
              disabled={isSubmitting}
            />
          </FormField>

          <FormField
            id="setup-password"
            label="Password"
            error={fieldErrors.password}
          >
            <PasswordInput
              id="setup-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password) || undefined}
              disabled={isSubmitting}
            />
          </FormField>

          <FormField
            id="setup-confirm-password"
            label="Confirm password"
            error={fieldErrors.confirmPassword}
          >
            <PasswordInput
              id="setup-confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.confirmPassword) || undefined}
              disabled={isSubmitting}
            />
          </FormField>

          <FormField
            id="setup-household"
            label="Household name"
            error={fieldErrors.householdName}
          >
            <Input
              id="setup-household"
              placeholder="For example, Smith Family"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.householdName) || undefined}
              disabled={isSubmitting}
            />
          </FormField>

          <LoadingButton
            type="submit"
            loading={isSubmitting}
            className="w-full"
          >
            Complete setup
          </LoadingButton>
        </FieldGroup>
      </form>
    </>
  )
}
