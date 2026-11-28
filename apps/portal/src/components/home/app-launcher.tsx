import type * as React from 'react'
import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import { EmptyState } from '@lumavault/ui/components/ui/custom/empty-state'
import {
  ExternalLinkIcon,
  FilmIcon,
  Gamepad2Icon,
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

export interface AppLauncherProps {
  enabledApps: readonly App[]
  appUrls: Record<App.PHOTOS | App.CINEMA | App.ARCADE, string>
}

export function AppLauncher({ enabledApps, appUrls }: AppLauncherProps) {
  const enabledSet = new Set(enabledApps)
  const enabledCards = APP_CATALOG.filter((item) => enabledSet.has(item.app))

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Apps</h2>
      {enabledCards.length === 0 ? (
        <EmptyState
          title="No apps enabled"
          description="Ask the server owner to enable Photos, Cinema, or Arcade for your household."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {enabledCards.map((item) => {
            const Icon = item.icon
            const url = appUrls[item.app]
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
  )
}
