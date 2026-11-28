import type * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '#components/ui/alert'
import { AlertCircleIcon } from 'lucide-react'

interface StatusAlertProps {
  variant?: React.ComponentProps<typeof Alert>['variant']
  icon?: React.ReactNode
  title?: React.ReactNode
  description: React.ReactNode
  className?: string
}

function StatusAlert({
  variant = 'default',
  icon,
  title,
  description,
  className,
}: StatusAlertProps) {
  const resolvedIcon =
    icon ?? (variant === 'destructive' ? <AlertCircleIcon /> : null)

  return (
    <Alert variant={variant} className={className}>
      {resolvedIcon}
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}

export { StatusAlert }
export type { StatusAlertProps }
