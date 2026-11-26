import { AuthGuard } from '@lumavault/ui/auth'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@lumavault/ui/components/ui/empty'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { ShieldAlertIcon } from 'lucide-react'

function AdminLayoutRoute() {
  return (
    <AuthGuard
      allowNoHousehold
      requireSuperAdmin
      forbiddenFallback={
        <div className="flex max-w-lg flex-col gap-6">
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldAlertIcon />
              </EmptyMedia>
              <EmptyTitle>Super-Admin access required</EmptyTitle>
              <EmptyDescription>
                Only the server owner can manage households, creation invites,
                and instance accounts.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/" />}
              >
                Back to Home
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      }
    >
      <Outlet />
    </AuthGuard>
  )
}

export const Route = createFileRoute('/_portal/admin')({
  component: AdminLayoutRoute,
})
