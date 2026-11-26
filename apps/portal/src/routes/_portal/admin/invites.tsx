import * as React from 'react'
import {
  App,
  IamService,
  type HouseholdInvite,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { emailSchema } from '@lumavault/ui/auth'
import { Alert, AlertDescription } from '@lumavault/ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@lumavault/ui/components/ui/alert-dialog'
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@lumavault/ui/components/ui/empty'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
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
import { appLabel } from '@lumavault/ui/household'
import { formatStorageCap } from '@lumavault/ui/lib/format-bytes'
import {
  createConnectQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@lumavault/ui/rpc'
import { createFileRoute } from '@tanstack/react-router'
import { CopyLinkAlert } from '#/components/copy-link-alert'
import { formatDate, rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, MailIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { AllowanceFields } from './-allowance-fields'
import {
  ALL_APPS,
  parseMemberLimit,
  parseStorageCapDraft,
  type StorageCapDraft,
} from './-storage-cap'

function AdminInvitesPage() {
  const queryClient = useQueryClient()
  const invitesQuery = useQuery(IamService.method.listHouseholdInvites)
  const createInvite = useMutation(IamService.method.createHouseholdInvite)
  const revokeInvite = useMutation(IamService.method.revokeHouseholdInvite)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [capDraft, setCapDraft] = React.useState<StorageCapDraft>({
    unlimited: false,
    amount: '500',
    unit: 'GB',
  })
  const [enabledApps, setEnabledApps] = React.useState<App[]>([...ALL_APPS])
  const [memberLimit, setMemberLimit] = React.useState('4')
  const [note, setNote] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  const [createdLink, setCreatedLink] = React.useState<{
    id?: string
    email: string
    url: string
  } | null>(null)
  const [revokeTarget, setRevokeTarget] =
    React.useState<HouseholdInvite | null>(null)

  const invitesQueryKey = createConnectQueryKey({
    schema: IamService.method.listHouseholdInvites,
    cardinality: 'finite',
  })

  function openCreateDialog() {
    setEmail('')
    setCapDraft({ unlimited: false, amount: '500', unit: 'GB' })
    setEnabledApps([...ALL_APPS])
    setMemberLimit('4')
    setNote('')
    setFormError(null)
    setCreateOpen(true)
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    const parsedEmail = emailSchema.safeParse(email)
    if (!parsedEmail.success) {
      setFormError(
        parsedEmail.error.issues[0]?.message ?? 'Enter a valid email address.',
      )
      return
    }
    const capBytes = parseStorageCapDraft(capDraft)
    if (capBytes === null) {
      setFormError('Enter a valid positive storage cap.')
      return
    }
    if (enabledApps.length === 0) {
      setFormError('Select at least one enabled app.')
      return
    }
    const parsedLimit = parseMemberLimit(memberLimit)
    if (parsedLimit === null) {
      setFormError('Enter a whole number between 1 and 2,147,483,647.')
      return
    }

    try {
      const res = await createInvite.mutateAsync({
        email: parsedEmail.data,
        allowance: {
          storageCapBytes: capBytes,
          enabledApps,
          memberLimit: parsedLimit,
        },
        note: note.trim(),
      })
      setCreateOpen(false)
      setCreatedLink({
        id: res.invite?.id,
        email: res.invite?.email ?? parsedEmail.data,
        url: res.inviteUrl,
      })
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey })
      toast.success('Household invite created and emailed.')
    } catch (err) {
      setFormError(rpcErrorMessage(err, 'Could not create household invite.'))
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return
    const revokedId = revokeTarget.id
    try {
      await revokeInvite.mutateAsync({ inviteId: revokedId })
      setRevokeTarget(null)
      setCreatedLink((prev) => (prev?.id === revokedId ? null : prev))
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey })
      toast.success('Household invite revoked.')
    } catch (err) {
      setRevokeTarget(null)
      toast.error(rpcErrorMessage(err, 'Could not revoke invite.'))
    }
  }

  const invites = invitesQuery.data?.invites ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Household invites
          </h1>
          <p className="text-sm text-muted-foreground">
            Invite people to create their own household with a preset storage
            cap and app allowance.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <PlusIcon data-icon="inline-start" />
          New household invite
        </Button>
      </div>

      {createdLink ? (
        <CopyLinkAlert
          title={`One-time invite link for ${createdLink.email}`}
          description="This link was emailed and will not be shown again because the server only stores its hash. Copy it now if you want to share it directly."
          url={createdLink.url}
          inputLabel="One-time household invite link"
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Open invites</CardTitle>
          <CardDescription>
            Active household creation links that have not been redeemed,
            revoked, or expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitesQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : invitesQuery.error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>
                {rpcErrorMessage(
                  invitesQuery.error,
                  'Could not load household invites.',
                )}
              </AlertDescription>
            </Alert>
          ) : invites.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MailIcon />
                </EmptyMedia>
                <EmptyTitle>No open household invites</EmptyTitle>
                <EmptyDescription>
                  Create an invite to let a new person start their own
                  household.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Cap</TableHead>
                  <TableHead>Apps</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">
                      {invite.email}
                    </TableCell>
                    <TableCell>
                      {formatStorageCap(
                        invite.allowance?.storageCapBytes ?? 0n,
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(invite.allowance?.enabledApps ?? []).map((app) => (
                          <Badge key={app} variant="secondary">
                            {appLabel(app)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{invite.allowance?.memberLimit ?? 4}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {invite.note || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTarget(invite)}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New household invite</DialogTitle>
            <DialogDescription>
              Create a single-use invite bound to one email address.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => void handleCreateSubmit(e)}
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
              <Field>
                <FieldLabel htmlFor="invite-create-email">Email</FieldLabel>
                <Input
                  id="invite-create-email"
                  type="email"
                  placeholder="friend@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <AllowanceFields
                idPrefix="invite"
                capDraft={capDraft}
                onCapChange={setCapDraft}
                enabledApps={enabledApps}
                onEnabledAppsChange={setEnabledApps}
                appsError={
                  enabledApps.length === 0
                    ? 'Select at least one enabled app.'
                    : null
                }
                memberLimit={memberLimit}
                onMemberLimitChange={setMemberLimit}
              />

              <Field>
                <FieldLabel htmlFor="invite-note">Note (optional)</FieldLabel>
                <Input
                  id="invite-note"
                  placeholder="For example, Parents"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createInvite.isPending}>
                {createInvite.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Create invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke household invite?</AlertDialogTitle>
            <AlertDialogDescription>
              The invite link sent to {revokeTarget?.email} will stop working
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revokeInvite.isPending}
              onClick={() => void handleConfirmRevoke()}
            >
              Revoke invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_portal/admin/invites')({
  component: AdminInvitesPage,
})
