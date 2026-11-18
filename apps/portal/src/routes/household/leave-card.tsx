import { type Member, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useHousehold, useLeaveHousehold, useViewer } from "@lumavault/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorMessage } from "@/lib/session";

/** Leaves the household. An Owner leaving others behind names the next Owner first. */
export function LeaveCard({ members }: { members: Member[] }) {
  const me = useViewer().data?.user?.id;
  const { household, role } = useHousehold();
  const leave = useLeaveHousehold();
  const navigate = useNavigate();
  const [nextOwner, setNextOwner] = useState("");
  const others = members.filter((m) => m.user?.id !== me);
  const mustPick = role === Role.OWNER && others.length > 0;

  const description =
    others.length === 0
      ? `You are the only member, so ${household?.name} closes when your 30 days are up.`
      : "You keep read-only access to your private data for 30 days. Join another household in that time to bring it along.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave household</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mustPick && (
          <FieldSet>
            <FieldLegend variant="label">Who owns {household?.name} after you leave?</FieldLegend>
            <RadioGroup value={nextOwner} onValueChange={(v) => setNextOwner(v as string)}>
              {others.map((m) => (
                <Field key={m.user?.id} orientation="horizontal">
                  <RadioGroupItem value={m.user?.id ?? ""} id={`next-owner-${m.user?.id}`} />
                  <FieldLabel htmlFor={`next-owner-${m.user?.id}`}>{m.user?.name}</FieldLabel>
                </Field>
              ))}
            </RadioGroup>
          </FieldSet>
        )}
        <FormError message={leave.error && errorMessage(leave.error)} />
        <Button
          variant="destructive"
          disabled={(mustPick && !nextOwner) || leave.isPending}
          onClick={async () => {
            try {
              await leave.mutateAsync({ nextOwnerUserId: nextOwner });
            } catch {
              return;
            }
            await navigate({ to: "/" });
          }}
        >
          Leave {household?.name}
        </Button>
      </CardContent>
    </Card>
  );
}
