import { useSignOut } from '@lumavault/ui/auth'
import { Badge } from '@lumavault/ui/components/ui/badge'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { roleLabel, useViewer } from '@lumavault/ui/household'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { LogOutIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PasskeysCard } from './-passkeys-card'
import { PasswordCard } from './-password-card'

function AccountPage() {
  const router = useRouter()
  const viewer = useViewer()
  const signOutAuth = useSignOut()

  async function handleSignOut() {
    const ok = await signOutAuth.signOut()
    if (!ok) {
      toast.error('Could not sign out. Please try again.')
      return
    }
    await router.navigate({ to: '/login', replace: true })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile, passkeys, password, and active session.
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

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Sign out of LumaVault on this browser.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            disabled={signOutAuth.isPending}
            onClick={() => void handleSignOut()}
          >
            {signOutAuth.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <LogOutIcon data-icon="inline-start" />
            )}
            Sign out
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_portal/account')({
  component: AccountPage,
})
