import * as React from 'react'
import {
  IamService,
  Role,
  type Member,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@lumavault/ui/components/ui/select'
import { Skeleton } from '@lumavault/ui/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumavault/ui/components/ui/table'
import { roleLabel, useViewer } from '@lumavault/ui/household'
import { useMutation } from '@lumavault/ui/rpc'
import { formatDate, rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, CrownIcon } from 'lucide-react'
import { toast } from 'sonner'

const ROLE_ITEMS = { admin: 'Admin', member: 'Member' } as const

export interface HouseholdMembersCardProps {
  householdName: string
  memberLimit: number
  members: readonly Member[]
  pendingCount: number
  isPending: boolean
  loadError: unknown
  onRefresh: () => Promise<void>
}

export function HouseholdMembersCard({
  householdName,
  memberLimit,
  members,
  pendingCount,
  isPending,
  loadError,
  onRefresh,
}: HouseholdMembersCardProps) {
  const viewer = useViewer()
  const updateRole = useMutation(IamService.method.updateMemberRole)
  const transferOwnership = useMutation(IamService.method.transferOwnership)

  const [actionError, setActionError] = React.useState<string | null>(null)
  const [transferTarget, setTransferTarget] = React.useState<Member | null>(
    null,
  )
  const [selfDemoteOpen, setSelfDemoteOpen] = React.useState(false)

  async function handleRoleChange(member: Member, nextValue: string | null) {
    if (!member.user || (nextValue !== 'admin' && nextValue !== 'member')) {
      return
    }
    const nextRole = nextValue === 'admin' ? Role.ADMIN : Role.MEMBER
    if (nextRole === member.role) return

    // Guard Admin self-demotion behind a confirmation dialog.
    if (
      member.user.id === viewer.user?.id &&
      viewer.role === Role.ADMIN &&
      nextRole === Role.MEMBER
    ) {
      setSelfDemoteOpen(true)
      return
    }

    setActionError(null)
    try {
      await updateRole.mutateAsync({
        userId: member.user.id,
        role: nextRole,
      })
      await onRefresh()
      toast.success(
        `Updated ${member.user.name}'s role to ${roleLabel(nextRole)}.`,
      )
    } catch (err) {
      setActionError(rpcErrorMessage(err, 'Could not update member role.'))
    }
  }

  async function handleConfirmSelfDemote() {
    if (!viewer.user) return
    setActionError(null)
    try {
      await updateRole.mutateAsync({
        userId: viewer.user.id,
        role: Role.MEMBER,
      })
      setSelfDemoteOpen(false)
      await onRefresh()
      toast.success('Your role has been changed to Member.')
    } catch (err) {
      setSelfDemoteOpen(false)
      setActionError(rpcErrorMessage(err, 'Could not update your role.'))
    }
  }

  async function handleConfirmTransfer() {
    if (!transferTarget?.user) return
    setActionError(null)
    try {
      await transferOwnership.mutateAsync({
        userId: transferTarget.user.id,
      })
      const newOwnerName = transferTarget.user.name
      setTransferTarget(null)
      await onRefresh()
      toast.success(`Transferred ownership to ${newOwnerName}.`)
    } catch (err) {
      setTransferTarget(null)
      setActionError(rpcErrorMessage(err, 'Could not transfer ownership.'))
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                {members.length} of {memberLimit} seats in use
                {pendingCount > 0 ? ` (${pendingCount} pending)` : ''}
              </CardDescription>
            </div>
            <Badge variant="outline">{roleLabel(viewer.role)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {actionError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>
                {rpcErrorMessage(loadError, 'Could not load members.')}
              </AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  {viewer.isHouseholdOwner ? (
                    <TableHead className="text-right">Ownership</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const user = member.user
                  if (!user) return null
                  const isOwner = member.role === Role.OWNER
                  const canEditRole = viewer.isHouseholdAdmin && !isOwner
                  const roleValue =
                    member.role === Role.ADMIN ? 'admin' : 'member'

                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {user.name}
                            {user.id === viewer.user?.id ? ' (you)' : ''}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {user.email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canEditRole ? (
                          <Select
                            items={ROLE_ITEMS}
                            value={roleValue}
                            onValueChange={(val) =>
                              void handleRoleChange(member, val)
                            }
                            disabled={updateRole.isPending}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Role for ${user.name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="member">Member</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={isOwner ? 'default' : 'secondary'}>
                            {roleLabel(member.role)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(member.joinedAt)}
                      </TableCell>
                      {viewer.isHouseholdOwner ? (
                        <TableCell className="text-right">
                          {!isOwner ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setTransferTarget(member)}
                            >
                              <CrownIcon data-icon="inline-start" />
                              Make Owner
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(transferTarget)}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer household ownership?</AlertDialogTitle>
            <AlertDialogDescription>
              {transferTarget?.user?.name} will become the Owner of{' '}
              {householdName}, and your role will change to Admin. Only the new
              Owner can transfer ownership back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={transferOwnership.isPending}
              onClick={() => void handleConfirmTransfer()}
            >
              Transfer ownership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={selfDemoteOpen} onOpenChange={setSelfDemoteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Step down from Admin?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing your own role to Member removes your ability to invite
              members or manage roles in {householdName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={updateRole.isPending}
              onClick={() => void handleConfirmSelfDemote()}
            >
              Become Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
