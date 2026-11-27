import * as React from 'react'
import {
  IamService,
  InviteKind,
  type InviteRef,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import {
  mapMagicLinkUrlError,
  useRefreshViewer,
  useSignOut,
} from '@lumavault/ui/auth'
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
  CardFooter,
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
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { roleLabel, useViewer } from '@lumavault/ui/household'
import { useMutation, useQuery } from '@lumavault/ui/rpc'
import { Link, useRouter } from '@tanstack/react-router'
import { AuthLayout } from '#/layout/auth-layout'
import { formatDate, rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, LogOutIcon } from 'lucide-react'

import { InviteAuthForm } from './-invite-auth-form'

export function inviteSearch(search: Record<string, unknown>) {
  return {
    error: typeof search.error === 'string' ? search.error : undefined,
  }
}

export interface InvitePageProps {
  inviteRef: InviteRef['invite']
  invitePath: string
  urlError?: string
}

export function InvitePage({
  inviteRef,
  invitePath,
  urlError,
}: InvitePageProps) {
  const router = useRouter()
  const refreshViewer = useRefreshViewer()
  const viewer = useViewer()
  const signOutAuth = useSignOut()
  const joinHousehold = useMutation(IamService.method.joinHousehold)

  const inviteQuery = useQuery(IamService.method.getInvite, {
    invite: { invite: inviteRef },
  })

  const [householdName, setHouseholdName] = React.useState('')
  const [householdError, setHouseholdError] = React.useState<string | null>(
    null,
  )
  const [joinError, setJoinError] = React.useState<string | null>(null)

  const inviteErrorMessage = inviteQuery.error
    ? rpcErrorMessage(inviteQuery.error, 'Could not load this invite.')
    : null

  if (inviteQuery.isPending || viewer.isPending) {
    return (
      <AuthLayout>
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      </AuthLayout>
    )
  }

  if (inviteErrorMessage || !inviteQuery.data) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
            <CardDescription>
              This invite link cannot be used right now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>
                {inviteErrorMessage ?? 'Invite not found.'}
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={viewer.isAuthenticated ? '/' : '/login'} />}
            >
              {viewer.isAuthenticated ? 'Go to Portal' : 'Go to sign in'}
            </Button>
          </CardFooter>
        </Card>
      </AuthLayout>
    )
  }

  const invite = inviteQuery.data
  const isNewHousehold = invite.kind === InviteKind.NEW_HOUSEHOLD
  const title = isNewHousehold
    ? 'Create your household'
    : `Join ${invite.householdName || 'household'}`
  const expiryText = invite.expiresAt ? formatDate(invite.expiresAt, '') : ''
  const mappedUrlError = mapMagicLinkUrlError(urlError)

  async function handleJoinSubmit(event: React.FormEvent) {
    event.preventDefault()
    setJoinError(null)
    if (isNewHousehold && !householdName.trim()) {
      setHouseholdError('Enter a name for your household.')
      return
    }
    setHouseholdError(null)

    try {
      await joinHousehold.mutateAsync({
        invite: { invite: inviteRef },
        householdName: isNewHousehold ? householdName.trim() : '',
      })
      await refreshViewer()
      await router.navigate({ to: '/', replace: true })
    } catch (err) {
      setJoinError(
        rpcErrorMessage(err, 'Could not redeem this invite. Please try again.'),
      )
    }
  }

  async function handleSignOut() {
    if (await signOutAuth.signOut()) {
      await router.navigate({ to: '/login', search: { returnTo: invitePath } })
    }
  }

  const emailMatches =
    viewer.user?.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{title}</CardTitle>
            <Badge variant="secondary">{roleLabel(invite.role)}</Badge>
          </div>
          <CardDescription>
            {invite.inviterName
              ? `${invite.inviterName} invited ${invite.email}`
              : `Invite for ${invite.email}`}
            {expiryText ? ` · Expires ${expiryText}` : ''}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {mappedUrlError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{mappedUrlError}</AlertDescription>
            </Alert>
          ) : null}

          {!viewer.isAuthenticated ? (
            <InviteAuthForm
              email={invite.email}
              invitePath={invitePath}
              isNewHousehold={isNewHousehold}
            />
          ) : !emailMatches ? (
            <div className="flex flex-col gap-4">
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Wrong account</AlertTitle>
                <AlertDescription>
                  You are signed in as {viewer.user?.email}, but this invite is
                  for {invite.email}. Sign out and switch accounts to accept it.
                </AlertDescription>
              </Alert>
              {signOutAuth.error ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{signOutAuth.error}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                variant="outline"
                disabled={signOutAuth.isPending}
                onClick={() => void handleSignOut()}
              >
                <LogOutIcon data-icon="inline-start" />
                Sign out and switch account
              </Button>
            </div>
          ) : viewer.hasHousehold ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Already in a household</AlertTitle>
                <AlertDescription>
                  You already belong to {viewer.household?.name}. Moving between
                  households is not supported yet.
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/" />}
              >
                Back to Portal
              </Button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleJoinSubmit(e)} noValidate>
              <FieldGroup>
                {joinError ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertDescription>{joinError}</AlertDescription>
                  </Alert>
                ) : null}

                {isNewHousehold ? (
                  <Field data-invalid={Boolean(householdError) || undefined}>
                    <FieldLabel htmlFor="join-household-name">
                      Household name
                    </FieldLabel>
                    <Input
                      id="join-household-name"
                      placeholder="For example, Patel Home"
                      value={householdName}
                      onChange={(e) => setHouseholdName(e.target.value)}
                      aria-invalid={Boolean(householdError) || undefined}
                      disabled={joinHousehold.isPending}
                    />
                    {householdError ? (
                      <FieldError>{householdError}</FieldError>
                    ) : null}
                  </Field>
                ) : null}

                <Button
                  type="submit"
                  disabled={joinHousehold.isPending}
                  className="w-full"
                >
                  {joinHousehold.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {isNewHousehold ? 'Create household' : title}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
