import * as React from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@lumavault/ui/components/ui/alert'
import { Button } from '@lumavault/ui/components/ui/button'
import { Input } from '@lumavault/ui/components/ui/input'
import { CheckIcon, CopyIcon, MailPlusIcon } from 'lucide-react'
import { toast } from 'sonner'

export interface CopyLinkAlertProps {
  title: string
  description: string
  url: string
  inputLabel: string
}

export function CopyLinkAlert({
  title,
  description,
  url,
  inputLabel,
}: CopyLinkAlertProps) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    setCopied(false)
  }, [url])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Invite link copied.')
    } catch {
      toast.error('Could not copy to clipboard.')
    }
  }

  return (
    <Alert>
      <MailPlusIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{description}</span>
        <div className="flex items-center gap-2">
          <Input readOnly value={url} aria-label={inputLabel} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
