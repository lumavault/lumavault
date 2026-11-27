import * as React from 'react'
import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@lumavault/ui/components/ui/empty'
import { Progress } from '@lumavault/ui/components/ui/progress'
import { roleLabel, useViewer } from '@lumavault/ui/household'
import {
  computeStorageSummary,
  formatBytes,
  formatStorageCap,
} from '@lumavault/ui/lib/format-bytes'
import { createFileRoute, Link } from '@tanstack/react-router'
import { portalConfig } from '#/config'
import {
  ExternalLinkIcon,
  FilmIcon,
  Gamepad2Icon,
  HardDriveIcon,
  HomeIcon,
  ImageIcon,
} from 'lucide-react'

interface AppMeta {
  app: App.PHOTOS | App.CINEMA | App.ARCADE
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const APP_CATALOG: readonly AppMeta[] = [
  {
    app: App.PHOTOS,
    title: 'Photos',
    description: 'Browse timelines, shared albums, and Live Photos.',
    icon: ImageIcon,
  },
  {
    app: App.CINEMA,
    title: 'Cinema',
    description: 'Stream movies and series in 4K with synced progress.',
    icon: FilmIcon,
  },
  {
    app: App.ARCADE,
    title: 'Arcade',
    description: 'Manage your console ROM library and versioned saves.',
    icon: Gamepad2Icon,
  },
]

function HomePage() {
  const viewer = useViewer()

  if (!viewer.household) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome{viewer.user?.name ? `, ${viewer.user.name}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your LumaVault account is active, but you are not in a household
            yet.
          </p>
        </div>

        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HomeIcon />
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
  const enabledSet = new Set(viewer.enabledApps)
  const enabledCards = APP_CATALOG.filter((item) => enabledSet.has(item.app))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {viewer.household.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {viewer.user?.name} ({roleLabel(viewer.role)})
          </p>
        </div>
      </div>

      {summary ? (
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
          <CardFooter>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to={'/household' as never} />}
            >
              Manage household
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Apps</h2>
        {enabledCards.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No apps enabled</EmptyTitle>
              <EmptyDescription>
                Ask the server owner to enable Photos, Cinema, or Arcade for
                your household.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {enabledCards.map((item) => {
              const Icon = item.icon
              const url = portalConfig.appUrls[item.app]
              return (
                <Card key={item.app}>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-primary" />
                      <CardTitle>{item.title}</CardTitle>
                    </div>
                    <CardDescription>{item.description}</CardDescription>
                  </CardHeader>
                  <CardFooter>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <a href={url} rel="noreferrer">
                          Open {item.title}
                          <ExternalLinkIcon data-icon="inline-end" />
                        </a>
                      }
                    />
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_portal/')({
  component: HomePage,
})
