import { Button } from '@lumavault/ui/components/ui/button'
import { PageHeader } from '@lumavault/ui/components/ui/custom/page-header'
import { roleLabel, useViewer } from '@lumavault/ui/household'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AppLauncher } from '#/components/home/app-launcher'
import { NoHouseholdState } from '#/components/household/no-household-state'
import { StorageSummaryCard } from '#/components/household/storage-summary-card'
import { portalConfig } from '#/config'

function HomePage() {
  const viewer = useViewer()

  if (!viewer.household) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader
          title={`Welcome${viewer.user?.name ? `, ${viewer.user.name}` : ''}`}
          description="Your LumaVault account is active, but you are not in a household yet."
        />
        <NoHouseholdState />
      </div>
    )
  }

  const capBytes = viewer.household.allowance?.storageCapBytes ?? 0n

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={viewer.household.name}
        description={`Signed in as ${viewer.user?.name ?? ''} (${roleLabel(viewer.role)})`}
      />

      {viewer.usage ? (
        <StorageSummaryCard
          usage={viewer.usage}
          capBytes={capBytes}
          footer={
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to={'/household' as never} />}
            >
              Manage household
            </Button>
          }
        />
      ) : null}

      <AppLauncher
        enabledApps={viewer.enabledApps}
        appUrls={portalConfig.appUrls}
      />
    </div>
  )
}

export const Route = createFileRoute('/_portal/')({
  component: HomePage,
})
