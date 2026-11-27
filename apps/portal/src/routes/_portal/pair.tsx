import * as React from 'react'
import { Code, ConnectError } from '@connectrpc/connect'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@lumavault/ui/components/ui/alert'
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@lumavault/ui/components/ui/field'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@lumavault/ui/components/ui/input-otp'
import { Spinner } from '@lumavault/ui/components/ui/spinner'
import { useViewer } from '@lumavault/ui/household'
import { useMutation } from '@lumavault/ui/rpc'
import { createFileRoute } from '@tanstack/react-router'
import { rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, CheckCircle2Icon, TvIcon } from 'lucide-react'

const PAIRING_CODE_LENGTH = 6

function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PAIRING_CODE_LENGTH)
}

function mapPairingError(err: unknown): string {
  if (err instanceof ConnectError && err.code === Code.NotFound) {
    return 'That code is wrong, expired, or already used. Check the TV and try again.'
  }
  return rpcErrorMessage(err, 'Could not approve pairing. Please try again.')
}

function PairPage() {
  const search = Route.useSearch()
  const viewer = useViewer()
  const approvePairing = useMutation(IamService.method.approvePairing)

  const [code, setCode] = React.useState(() =>
    normalizePairingCode(search.code ?? ''),
  )
  const [approvedDevice, setApprovedDevice] = React.useState<string | null>(
    null,
  )
  const household = viewer.household

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    approvePairing.mutate(
      { code },
      {
        onSuccess: (res) => {
          setApprovedDevice(res.deviceName || 'Apple TV')
          setCode('')
        },
      },
    )
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Pair Apple TV</h1>
        <p className="text-sm text-muted-foreground">
          Enter the {PAIRING_CODE_LENGTH}-character code shown on your TV.
          {household ? ` It will open in ${household.name}.` : null}
        </p>
      </div>

      {!household ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TvIcon />
            </EmptyMedia>
            <EmptyTitle>Join a household first</EmptyTitle>
            <EmptyDescription>
              You need to belong to a household before pairing an Apple TV.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Approve TV sign-in</CardTitle>
            <CardDescription>Household: {household.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {approvedDevice ? (
              <div className="flex flex-col gap-4">
                <Alert>
                  <CheckCircle2Icon />
                  <AlertTitle>TV signed in</AlertTitle>
                  <AlertDescription>
                    {approvedDevice} is now signed in to {household.name}.
                  </AlertDescription>
                </Alert>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setApprovedDevice(null)
                    approvePairing.reset()
                  }}
                >
                  Pair another Apple TV
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <FieldGroup>
                  {approvePairing.error ? (
                    <Alert variant="destructive">
                      <AlertCircleIcon />
                      <AlertDescription>
                        {mapPairingError(approvePairing.error)}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="pairing-code">Pairing code</FieldLabel>
                    <div className="flex justify-center py-2">
                      <InputOTP
                        id="pairing-code"
                        maxLength={PAIRING_CODE_LENGTH}
                        value={code}
                        onChange={(value) => {
                          approvePairing.reset()
                          setCode(normalizePairingCode(value))
                        }}
                        pasteTransformer={normalizePairingCode}
                        disabled={approvePairing.isPending}
                      >
                        {[0, 3].map((start) => (
                          <React.Fragment key={start}>
                            {start > 0 ? <InputOTPSeparator /> : null}
                            <InputOTPGroup>
                              {[start, start + 1, start + 2].map((index) => (
                                <InputOTPSlot
                                  key={index}
                                  index={index}
                                  className="size-10 text-base font-mono"
                                />
                              ))}
                            </InputOTPGroup>
                          </React.Fragment>
                        ))}
                      </InputOTP>
                    </div>
                    <FieldDescription>
                      Spaces, dashes, and lowercase letters are handled
                      automatically.
                    </FieldDescription>
                  </Field>

                  <Button
                    type="submit"
                    disabled={
                      approvePairing.isPending ||
                      code.length !== PAIRING_CODE_LENGTH
                    }
                    className="w-full"
                  >
                    {approvePairing.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    Approve Apple TV
                  </Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_portal/pair')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
  }),
  component: PairPage,
})
