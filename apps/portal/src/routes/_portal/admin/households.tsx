import * as React from 'react'
import { create } from '@bufbuild/protobuf'
import { FieldMaskSchema } from '@bufbuild/protobuf/wkt'
import {
  App,
  IamService,
  type HouseholdSummary,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { Alert, AlertDescription } from '@lumavault/ui/components/ui/alert'
import { Badge } from '@lumavault/ui/components/ui/badge'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@lumavault/ui/components/ui/dialog'
import { FieldGroup } from '@lumavault/ui/components/ui/field'
import { Skeleton } from '@lumavault/ui/components/ui/skeleton'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumavault/ui/components/ui/table'
import { appLabel, useViewer, viewerQueryKey } from '@lumavault/ui/household'
import {
  computeStorageSummary,
  formatBytes,
  formatStorageCap,
} from '@lumavault/ui/lib/format-bytes'
import {
  createConnectQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@lumavault/ui/rpc'
import { createFileRoute } from '@tanstack/react-router'
import {
  CursorPagination,
  useCursorPagination,
} from '#/components/cursor-pagination'
import { rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, SlidersHorizontalIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AllowanceFields } from './-allowance-fields'
import {
  capBytesToDraft,
  parseMemberLimit,
  parseStorageCapDraft,
  sameApps,
  type StorageCapDraft,
} from './-storage-cap'

const PAGE_SIZE = 20
const DEFAULT_MEMBER_LIMIT = 4

function AdminHouseholdsPage() {
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const pagination = useCursorPagination()

  const householdsQuery = useQuery(IamService.method.listHouseholds, {
    pageSize: PAGE_SIZE,
    pageToken: pagination.pageToken,
  })
  const updateAllowance = useMutation(
    IamService.method.updateHouseholdAllowance,
  )

  const [editing, setEditing] = React.useState<HouseholdSummary | null>(null)
  const [capDraft, setCapDraft] = React.useState<StorageCapDraft>(() =>
    capBytesToDraft(0n),
  )
  const [capTouched, setCapTouched] = React.useState(false)
  const [enabledApps, setEnabledApps] = React.useState<App[]>([])
  const [memberLimit, setMemberLimit] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  function openEditDialog(summary: HouseholdSummary) {
    const allowance = summary.household?.allowance
    setEditing(summary)
    setCapDraft(capBytesToDraft(allowance?.storageCapBytes ?? 0n))
    setCapTouched(false)
    setEnabledApps([...(allowance?.enabledApps ?? [])])
    setMemberLimit(String(allowance?.memberLimit ?? DEFAULT_MEMBER_LIMIT))
    setFormError(null)
  }

  const originalAllowance = editing?.household?.allowance
  const originalCapBytes = originalAllowance?.storageCapBytes ?? 0n
  const originalApps = originalAllowance?.enabledApps ?? []
  const originalLimit = originalAllowance?.memberLimit ?? DEFAULT_MEMBER_LIMIT

  const parsedCapBytes = capTouched
    ? parseStorageCapDraft(capDraft)
    : originalCapBytes
  const capChanged =
    capTouched && parsedCapBytes !== null && parsedCapBytes !== originalCapBytes

  const appsChanged = Boolean(editing) && !sameApps(enabledApps, originalApps)

  const parsedMemberLimit = parseMemberLimit(memberLimit)
  const limitChanged =
    Boolean(editing) &&
    parsedMemberLimit !== null &&
    parsedMemberLimit !== originalLimit

  const changedPaths: string[] = []
  if (capChanged) changedPaths.push('storage_cap_bytes')
  if (appsChanged) changedPaths.push('enabled_apps')
  if (limitChanged) changedPaths.push('member_limit')

  const capError =
    capTouched && parsedCapBytes === null
      ? 'Enter a whole number greater than 0.'
      : null
  const appsError =
    enabledApps.length === 0 ? 'Select at least one enabled app.' : null
  const memberLimitError =
    parsedMemberLimit === null
      ? 'Enter a whole number between 1 and 2,147,483,647.'
      : null

  const canSave =
    Boolean(editing) &&
    changedPaths.length > 0 &&
    !capError &&
    !appsError &&
    !memberLimitError &&
    !updateAllowance.isPending

  async function handleSaveAllowance(event: React.FormEvent) {
    event.preventDefault()
    if (!editing?.household || !canSave || parsedMemberLimit === null) return

    setFormError(null)
    try {
      await updateAllowance.mutateAsync({
        householdId: editing.household.id,
        allowance: {
          storageCapBytes: parsedCapBytes ?? originalCapBytes,
          enabledApps,
          memberLimit: parsedMemberLimit,
        },
        updateMask: create(FieldMaskSchema, { paths: changedPaths }),
      })

      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: IamService.method.listHouseholds,
          cardinality: 'finite',
        }),
      })
      if (editing.household.id === viewer.household?.id) {
        await queryClient.invalidateQueries({ queryKey: viewerQueryKey() })
      }
      toast.success(`Updated allowance for ${editing.household.name}.`)
      setEditing(null)
    } catch (err) {
      setFormError(
        rpcErrorMessage(err, 'Could not update household allowance.'),
      )
    }
  }

  const households = householdsQuery.data?.households ?? []
  const nextPageToken = householdsQuery.data?.nextPageToken ?? ''

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Households</h1>
        <p className="text-sm text-muted-foreground">
          Inspect every household on this server and adjust storage caps,
          enabled apps, and member limits.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All households</CardTitle>
          <CardDescription>
            Lowering a cap or member limit below current usage only blocks new
            uploads or invites.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {householdsQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : householdsQuery.error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>
                {rpcErrorMessage(
                  householdsQuery.error,
                  'Could not load households.',
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Household</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Apps</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {households.map((item) => {
                  const house = item.household
                  if (!house) return null
                  const capBytes = house.allowance?.storageCapBytes ?? 0n
                  const summary = item.usage
                    ? computeStorageSummary(item.usage, capBytes)
                    : null

                  return (
                    <TableRow key={house.id}>
                      <TableCell className="font-medium">
                        {house.name}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{item.owner?.name ?? '—'}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.owner?.email ?? ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>
                            {summary
                              ? `${formatBytes(summary.usedBytes)} / ${formatStorageCap(capBytes)}`
                              : formatStorageCap(capBytes)}
                          </span>
                          {summary?.isOverCap ? (
                            <Badge variant="destructive" className="w-fit">
                              Over cap
                            </Badge>
                          ) : summary && summary.reservedBytes > 0n ? (
                            <span className="text-xs text-muted-foreground">
                              {formatBytes(summary.reservedBytes)} reserved
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(house.allowance?.enabledApps ?? []).map((app) => (
                            <Badge key={app} variant="secondary">
                              {appLabel(app)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.memberCount} / {house.allowance?.memberLimit ?? 0}
                        {item.pendingInviteCount > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            (+{item.pendingInviteCount} pending)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(item)}
                        >
                          <SlidersHorizontalIcon data-icon="inline-start" />
                          Edit allowance
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          <CursorPagination
            hasPrevious={pagination.hasPrevious}
            nextPageToken={nextPageToken}
            onPrevious={pagination.goPrevious}
            onNext={pagination.goNext}
          />
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit allowance: {editing?.household?.name}
            </DialogTitle>
            <DialogDescription>
              Only the fields you change are sent to the server.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => void handleSaveAllowance(e)}
            noValidate
            className="flex flex-col gap-4"
          >
            {formError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <AllowanceFields
                idPrefix="edit"
                capDraft={capDraft}
                onCapChange={(next) => {
                  setCapTouched(true)
                  setCapDraft(next)
                }}
                capError={capError}
                enabledApps={enabledApps}
                onEnabledAppsChange={setEnabledApps}
                appsError={appsError}
                memberLimit={memberLimit}
                onMemberLimitChange={setMemberLimit}
                memberLimitError={memberLimitError}
              />
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {updateAllowance.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Route = createFileRoute('/_portal/admin/households')({
  component: AdminHouseholdsPage,
})
