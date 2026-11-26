import * as React from 'react'
import { Button } from '#components/ui/button'
import { Input } from '#components/ui/input'
import { cn } from '#lib/utils'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, 'type'>

function PasswordInput({ className, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={cn('pr-7', className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}

export { PasswordInput }
export type { PasswordInputProps }
