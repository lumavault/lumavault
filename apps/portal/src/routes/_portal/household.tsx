import { Badge } from '@lumavault/ui/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@lumavault/ui/components/ui/empty'
import { Progress } from '@lumavault/ui/components/ui/progress'
import { useViewer } from '@lumavault/ui/household'
import {
  computeStorageSummary,
  formatBytes,
  formatStorageCap,
} from '@lumavault/ui/lib/format-bytes'
import { createFileRoute } from '@tanstack/react-router'
import { HardDriveIcon, UsersIcon } from 'lucide-react'

import { HouseholdInvitesCard } from './-household-invites-card'
import { HouseholdMembersCard } from './-household-members-card'

function HouseholdPage() {
  const viewer = useViewer()

  if (!viewer.household) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Household</h1>
          <p className="text-sm text-muted-foreground">
            View storage usage and manage household members.
          </p>
        </div>

        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No household yet</EmptyTitle>
            <EmptyDescription>
              Ask a household Admin or the server owner for an invite link to
              join or create a household.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const capBytes = viewer.household.allowance?.storageCapBytes ?? 0n
  const summary = viewer.usage
    ? computeStorageSummary(viewer.usage, capBytes)
    : null

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {viewer.household.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Storage quota, household members, and member invitations.
        </p>
      </div>

      {summary ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDriveIcon className="size-4 text-muted-foreground" />
                <CardTitle>Storage</CardTitle>
              </div>
              {summary.isOverCap ? (
                <Badge variant="destructive">
                  Over cap by {formatBytes(summary.overCapBytes)}
                </Badge>
              ) : summary.isUnlimited ? (
                <Badge variant="secondary">Unlimited</Badge>
              ) : (
                <Badge variant="secondary">
                  {Math.round(summary.percentUsed)}% used
                </Badge>
              )}
            </div>
            <CardDescription>
              {formatBytes(summary.usedBytes)} used ·{' '}
              {formatBytes(summary.reservedBytes)} reserved ·{' '}
              {summary.isUnlimited
                ? 'Unlimited cap'
                : `${formatBytes(summary.remainingBytes)} remaining of ${formatStorageCap(summary.capBytes)}`}
            </CardDescription>
          </CardHeader>
          {!summary.isUnlimited ? (
            <CardContent>
              <Progress value={summary.percentUsed} />
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <HouseholdMembersCard />

      {viewer.isHouseholdAdmin ? <HouseholdInvitesCard /> : null}
    </div>
  )
}

export const Route = createFileRoute('/_portal/household')({
  component: HouseholdPage,
})
