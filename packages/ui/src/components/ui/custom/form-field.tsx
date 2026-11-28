import type * as React from 'react'
import { Field, FieldError, FieldLabel } from '#components/ui/field'

interface FormFieldProps {
  id: string
  label: React.ReactNode
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
}

function FormField({ id, label, error, children, className }: FormFieldProps) {
  return (
    <Field data-invalid={Boolean(error) || undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export { FormField }
export type { FormFieldProps }
