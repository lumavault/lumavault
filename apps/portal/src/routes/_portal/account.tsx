import { Badge } from '@lumavault/ui/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import { roleLabel, useViewer } from '@lumavault/ui/household'
import { createFileRoute } from '@tanstack/react-router'

import { PasskeysCard } from './-passkeys-card'
import { PasswordCard } from './-password-card'

function AccountPage() {
  const viewer = useViewer()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile, passkeys, and password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Your identity across all LumaVault apps.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{viewer.user?.name}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{viewer.user?.email}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Household</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {viewer.household?.name ?? 'No household'}
              </span>
              {viewer.household ? (
                <Badge variant="secondary">{roleLabel(viewer.role)}</Badge>
              ) : null}
              {viewer.isSuperAdmin ? <Badge>Super-Admin</Badge> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <PasskeysCard />

      <PasswordCard />
    </div>
  )
}

export const Route = createFileRoute('/_portal/account')({
  component: AccountPage,
})
