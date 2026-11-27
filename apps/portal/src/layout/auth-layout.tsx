import * as React from 'react'
import { ModeToggle } from '@lumavault/ui/components/ui/custom/mode-toggle'
import { HardDriveIcon } from 'lucide-react'

export interface AuthLayoutProps {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center bg-muted/40 p-6 md:p-10">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-medium">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardDriveIcon className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">
            LumaVault
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}
