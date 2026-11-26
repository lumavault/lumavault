import * as React from 'react'
import { mapAuthError, useAuthClient } from '@lumavault/ui/auth'
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
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
import { Field, FieldLabel } from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import { Skeleton } from '@lumavault/ui/components/ui/skeleton'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDate } from '#/lib/format'
import {
  AlertCircleIcon,
  KeyRoundIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'

const PASSKEYS_QUERY_KEY = ['auth', 'passkeys'] as const

export function PasskeysCard() {
  const queryClient = useQueryClient()
  const authClient = useAuthClient()

  const passkeysQuery = useQuery({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: async () => {
      const res = await authClient.passkey.listUserPasskeys()
      if (res?.error) {
        throw new Error(mapAuthError(res.error))
      }
      return res?.data ?? []
    },
  })

  const addPasskeyMutation = useMutation({
    mutationFn: async (input?: { name?: string }) => {
      const res = await authClient.passkey.addPasskey(input)
      if (res?.error) {
        throw new Error(mapAuthError(res.error))
      }
      return res?.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY })
    },
  })

  const deletePasskeyMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      const res = await authClient.passkey.deletePasskey(input)
      if (res?.error) {
        throw new Error(mapAuthError(res.error))
      }
      return res?.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY })
    },
  })

  const [passkeyName, setPasskeyName] = React.useState('')
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<{
    id: string
    name?: string | null
  } | null>(null)

  const passkeys = passkeysQuery.data ?? []
  const errorMessage = actionError ?? passkeysQuery.error?.message ?? null

  async function handleAddPasskey(event: React.FormEvent) {
    event.preventDefault()
    setActionError(null)
    try {
      await addPasskeyMutation.mutateAsync(
        passkeyName.trim() ? { name: passkeyName.trim() } : undefined,
      )
      setPasskeyName('')
      toast.success('Passkey registered.')
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not add passkey.',
      )
    }
  }

  async function handleConfirmDeletePasskey() {
    if (!deleteTarget) return
    setActionError(null)
    try {
      await deletePasskeyMutation.mutateAsync({ id: deleteTarget.id })
      setDeleteTarget(null)
      toast.success('Passkey removed.')
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not delete passkey.',
      )
      setDeleteTarget(null)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Sign in quickly with Touch ID, Face ID, or a security key.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <form
            onSubmit={(e) => void handleAddPasskey(e)}
            className="flex flex-wrap items-end gap-2"
          >
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="passkey-name">
                Device label (optional)
              </FieldLabel>
              <Input
                id="passkey-name"
                placeholder="For example, MacBook Pro"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                disabled={addPasskeyMutation.isPending}
              />
            </Field>
            <Button type="submit" disabled={addPasskeyMutation.isPending}>
              {addPasskeyMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              Add passkey
            </Button>
          </form>

          {passkeysQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : passkeys.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>No passkeys registered</EmptyTitle>
                <EmptyDescription>
                  Add a passkey on this device for passwordless sign-in.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {pk.name || 'Unnamed passkey'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {formatDate(pk.createdAt, 'Recently added')}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(pk)}
                    aria-label={`Delete ${pk.name || 'passkey'}`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {deleteTarget?.name || 'this passkey'} from your account?
              You will no longer be able to sign in with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePasskeyMutation.isPending}
              onClick={() => void handleConfirmDeletePasskey()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
