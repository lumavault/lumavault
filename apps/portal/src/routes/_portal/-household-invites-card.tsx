import * as React from 'react'
import {
  IamService,
  Role,
  type MemberInvite,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { emailSchema } from '@lumavault/ui/auth'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@lumavault/ui/components/ui/alert'
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@lumavault/ui/components/ui/select'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumavault/ui/components/ui/table'
import { roleLabel } from '@lumavault/ui/household'
import { useMutation } from '@lumavault/ui/rpc'
import { CopyLinkAlert } from '#/components/copy-link-alert'
import { formatDate, rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, MailPlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

const ROLE_ITEMS = { admin: 'Admin', member: 'Member' } as const

export interface HouseholdInvitesCardProps {
  pendingInvites: readonly MemberInvite[]
  seatsRemaining: number | undefined
  onRefreshMembers: () => Promise<void>
}

export function HouseholdInvitesCard({
  pendingInvites,
  seatsRemaining,
  onRefreshMembers,
}: HouseholdInvitesCardProps) {
  const inviteMember = useMutation(IamService.method.inviteMember)
  const cancelInvite = useMutation(IamService.method.cancelMemberInvite)

  const [inviteEmail, setInviteEmail] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState<'member' | 'admin'>(
    'member',
  )
  const [inviteEmailError, setInviteEmailError] = React.useState<string | null>(
    null,
  )
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [createdInviteUrl, setCreatedInviteUrl] = React.useState<string | null>(
    null,
  )

  const noSeats = seatsRemaining === 0
  const formDisabled =
    inviteMember.isPending || seatsRemaining === undefined || noSeats

  async function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault()
    setInviteError(null)
    setCreatedInviteUrl(null)

    const parsed = emailSchema.safeParse(inviteEmail)
    if (!parsed.success) {
      setInviteEmailError(
        parsed.error.issues[0]?.message ?? 'Enter a valid email address.',
      )
      return
    }
    setInviteEmailError(null)

    try {
      const res = await inviteMember.mutateAsync({
        email: parsed.data,
        role: inviteRole === 'admin' ? Role.ADMIN : Role.MEMBER,
      })
      setInviteEmail('')
      setCreatedInviteUrl(res.inviteUrl)
      await onRefreshMembers()
      toast.success('Member invite created and emailed.')
    } catch (err) {
      setInviteError(rpcErrorMessage(err, 'Could not create invite.'))
    }
  }

  async function handleCancelInvite(inviteId: string) {
    setInviteError(null)
    try {
      await cancelInvite.mutateAsync({ inviteId })
      await onRefreshMembers()
      toast.success('Invite cancelled.')
    } catch (err) {
      setInviteError(rpcErrorMessage(err, 'Could not cancel invite.'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Invite members</CardTitle>
            <CardDescription>
              Invites are emailed and also give you a link you can copy.
            </CardDescription>
          </div>
          {seatsRemaining !== undefined ? (
            <Badge variant={seatsRemaining > 0 ? 'secondary' : 'destructive'}>
              {seatsRemaining === 1
                ? '1 seat remaining'
                : `${seatsRemaining} seats remaining`}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {inviteError ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{inviteError}</AlertDescription>
          </Alert>
        ) : null}

        {noSeats ? (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>No seats remaining</AlertTitle>
            <AlertDescription>
              Cancel a pending invite or ask the server owner to raise your
              household member limit before inviting someone new.
            </AlertDescription>
          </Alert>
        ) : null}

        {createdInviteUrl ? (
          <CopyLinkAlert
            title="Invite sent"
            description="The invite was emailed. You can also share this link directly:"
            url={createdInviteUrl}
            inputLabel="Member invite link"
          />
        ) : null}

        <form onSubmit={(e) => void handleInviteSubmit(e)} noValidate>
          <FieldGroup className="sm:flex-row sm:items-end">
            <Field
              className="flex-1"
              data-invalid={Boolean(inviteEmailError) || undefined}
            >
              <FieldLabel htmlFor="member-invite-email">Email</FieldLabel>
              <Input
                id="member-invite-email"
                type="email"
                placeholder="person@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                aria-invalid={Boolean(inviteEmailError) || undefined}
                disabled={formDisabled}
              />
              {inviteEmailError ? (
                <FieldError>{inviteEmailError}</FieldError>
              ) : null}
            </Field>

            <Field className="sm:w-36">
              <FieldLabel htmlFor="member-invite-role">Role</FieldLabel>
              <Select
                items={ROLE_ITEMS}
                value={inviteRole}
                onValueChange={(v) => {
                  if (v === 'admin' || v === 'member') setInviteRole(v)
                }}
                disabled={formDisabled}
              >
                <SelectTrigger id="member-invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Button type="submit" disabled={formDisabled}>
              {inviteMember.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <MailPlusIcon data-icon="inline-start" />
              )}
              Send invite
            </Button>
          </FieldGroup>
        </form>

        {pendingInvites.length > 0 ? (
          <div className="flex flex-col gap-2 pt-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Pending invitations
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">
                      {invite.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {roleLabel(invite.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={cancelInvite.isPending}
                        onClick={() => void handleCancelInvite(invite.id)}
                      >
                        <XIcon data-icon="inline-start" />
                        Cancel
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
