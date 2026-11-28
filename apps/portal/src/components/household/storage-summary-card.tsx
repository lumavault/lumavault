import type * as React from 'react'
import { Badge } from '@lumavault/ui/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import { Progress } from '@lumavault/ui/components/ui/progress'
import {
  computeStorageSummary,
  formatBytes,
  formatStorageCap,
  type StorageUsageInput,
} from '@lumavault/ui/lib/format-bytes'
import { HardDriveIcon } from 'lucide-react'

export interface StorageSummaryCardProps {
  usage: StorageUsageInput
  capBytes: bigint
  footer?: React.ReactNode
}

export function StorageSummaryCard({
  usage,
  capBytes,
  footer,
}: StorageSummaryCardProps) {
  const summary = computeStorageSummary(usage, capBytes)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HardDriveIcon className="size-4 text-muted-foreground" />
            <CardTitle>Household Storage</CardTitle>
          </div>
          {summary.isOverCap ? (
            <Badge variant="destructive">Over cap</Badge>
          ) : summary.isUnlimited ? (
            <Badge variant="secondary">Unlimited</Badge>
          ) : (
            <Badge variant="secondary">
              {Math.round(summary.percentUsed)}% used
            </Badge>
          )}
        </div>
        <CardDescription>
          {formatBytes(summary.usedBytes)} used
          {summary.reservedBytes > 0n
            ? ` (${formatBytes(summary.reservedBytes)} reserved)`
            : ''}{' '}
          of {formatStorageCap(summary.capBytes)}
        </CardDescription>
      </CardHeader>
      {!summary.isUnlimited ? (
        <CardContent>
          <Progress value={summary.percentUsed} />
        </CardContent>
      ) : null}
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  )
}
