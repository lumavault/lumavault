import type * as React from 'react'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import { ExternalLinkIcon } from 'lucide-react'

export interface AppCardProps {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  href: string
}

export function AppCard({
  title,
  description,
  icon: Icon,
  href,
}: AppCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a href={href} rel="noreferrer">
              Open {title}
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          }
        />
      </CardFooter>
    </Card>
  )
}
