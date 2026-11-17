import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation } from "@connectrpc/connect-query";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useViewer } from "@lumavault/ui";
import { createRoute } from "@tanstack/react-router";
import { CircleCheckIcon, TvIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { appRoute } from "@/layout/routes";

const CODE_LENGTH = 6;
// The code alphabet on the TV: digits 2 to 9 and letters without I or O.
const CODE_PATTERN = "^[2-9A-HJ-NP-Za-hj-np-z]+$";

/** Turns the API's error into what to do next. Wrong, expired, and burned codes look the same to the server. */
function pairingError(err: unknown): string {
  const e = ConnectError.from(err);
  switch (e.code) {
    case Code.NotFound:
      return "That code did not work. Check the code on the TV. If it has been more than 10 minutes, start pairing again on the TV for a new code.";
    case Code.PermissionDenied:
      return "You are not a member of that household. Pick one of yours.";
    case Code.ResourceExhausted:
      return "Too many tries. Wait a few minutes, then try again.";
    default:
      return e.rawMessage;
  }
}

/** Approve an Apple TV from a phone: type the code it shows and pick the household it opens in. */
export function PairPage() {
  const viewer = useViewer();
  const approve = useMutation(IamService.method.approvePairing);
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const memberships = viewer.data?.memberships ?? [];
  const householdId = picked ?? viewer.data?.activeHouseholdId ?? memberships[0]?.household?.id ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await approve.mutateAsync({ code, householdId });
      setPaired(res.deviceName);
      setCode("");
    } catch {
      // Shown below from approve.error.
    }
  };

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TvIcon />
          Pair an Apple TV
        </CardTitle>
        <CardDescription>Open LumaVault on the Apple TV, then type the code it shows.</CardDescription>
      </CardHeader>
      <CardContent>
        {paired ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <CircleCheckIcon />
              <AlertTitle>{paired} is signed in</AlertTitle>
              <AlertDescription>It opens in your household within a few seconds.</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => setPaired(null)}>
              Pair another
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pair-code">Code</FieldLabel>
                <InputOTP
                  id="pair-code"
                  maxLength={CODE_LENGTH}
                  pattern={CODE_PATTERN}
                  value={code}
                  onChange={(v) => setCode(v.toUpperCase())}
                  inputMode="text"
                  autoComplete="one-time-code"
                  containerClassName="justify-center"
                >
                  <InputOTPGroup>
                    {Array.from({ length: CODE_LENGTH }, (_, i) => (
                      <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </Field>
              {memberships.length > 1 && (
                <Field>
                  <FieldLabel>Household</FieldLabel>
                  <Select value={householdId} onValueChange={(v) => setPicked(v as string)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{memberships.find((m) => m.household?.id === householdId)?.household?.name}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {memberships.map((m) => (
                          <SelectItem key={m.household?.id} value={m.household?.id ?? ""}>
                            {m.household?.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>The Apple TV opens in this household.</FieldDescription>
                </Field>
              )}
              <FormError message={approve.error && pairingError(approve.error)} />
              <Button type="submit" size="lg" disabled={code.length !== CODE_LENGTH || !householdId || approve.isPending}>
                Approve
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export const route = createRoute({ getParentRoute: () => appRoute, path: "/pair", component: PairPage, staticData: { title: "Pair Apple TV" } });
