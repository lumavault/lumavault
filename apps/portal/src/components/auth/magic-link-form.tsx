import * as React from 'react'
import { magicLinkSchema } from '@lumavault/ui/auth'
import { Button } from '@lumavault/ui/components/ui/button'
import { FormField } from '@lumavault/ui/components/ui/custom/form-field'
import { LoadingButton } from '@lumavault/ui/components/ui/custom/loading-button'
import { StatusAlert } from '@lumavault/ui/components/ui/custom/status-alert'
import { FieldGroup } from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import { MailIcon } from 'lucide-react'

export interface MagicLinkFormProps {
  disabled?: boolean
  isSubmitting?: boolean
  sent: boolean
  onSubmit: (email: string) => Promise<void> | void
  onReset: () => void
}

export function MagicLinkForm({
  disabled = false,
  isSubmitting = false,
  sent,
  onSubmit,
  onReset,
}: MagicLinkFormProps) {
  const [email, setEmail] = React.useState('')
  const [fieldError, setFieldError] = React.useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = magicLinkSchema.safeParse({ email })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email.')
      return
    }
    setFieldError(null)
    await onSubmit(parsed.data.email)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <StatusAlert
          icon={<MailIcon />}
          title="Check your email"
          description={`We sent a one-time sign-in link to ${email}. Open it on this device to sign in.`}
        />
        <Button type="button" variant="outline" onClick={onReset}>
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      <FieldGroup>
        <FormField id="magic-email" label="Email" error={fieldError}>
          <Input
            id="magic-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldError) || undefined}
            disabled={disabled || isSubmitting}
          />
        </FormField>

        <LoadingButton
          type="submit"
          loading={isSubmitting}
          disabled={disabled}
          icon={<MailIcon data-icon="inline-start" />}
          className="w-full"
        >
          Send sign-in link
        </LoadingButton>
      </FieldGroup>
    </form>
  )
}
