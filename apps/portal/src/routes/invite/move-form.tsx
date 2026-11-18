import { useQuery } from "@connectrpc/connect-query";
import { type GetInviteResponse, IamService, type ItemRef, InviteKind } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { formatBytes } from "@lumavault/ui";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { appInfo } from "@/lib/apps";

export interface MoveChoices {
  householdName: string;
  copyItems: ItemRef[];
  nextOwnerUserId: string;
}

const refKey = (r: ItemRef) => `${r.app}/${r.kind}/${r.id}`;

/**
 * What using an invite involves for someone already in a household: their private data moves,
 * they pick shared items to copy, and an Owner leaving others behind picks the next Owner.
 */
export function MoveForm({ invite, onChange }: { invite: GetInviteResponse; onChange: (c: MoveChoices) => void }) {
  const move = invite.move;
  const items = useQuery(IamService.method.listCopyableItems, {}, { enabled: Boolean(move) });
  const [choices, setChoices] = useState<MoveChoices>({ householdName: "", copyItems: [], nextOwnerUserId: "" });
  const update = (c: Partial<MoveChoices>) => {
    const next = { ...choices, ...c };
    setChoices(next);
    onChange(next);
  };
  const toggle = (ref: ItemRef, on: boolean) =>
    update({ copyItems: on ? [...choices.copyItems, ref] : choices.copyItems.filter((r) => refKey(r) !== refKey(ref)) });

  return (
    <FieldGroup>
      {invite.kind === InviteKind.NEW_HOUSEHOLD && (
        <Field>
          <FieldLabel htmlFor="householdName">Household name</FieldLabel>
          <Input id="householdName" value={choices.householdName} onChange={(e) => update({ householdName: e.target.value })} />
        </Field>
      )}
      {move && (
        <>
          <p className="text-sm">
            You will leave <span className="font-medium">{move.currentHousehold?.name}</span>. Your {formatBytes(move.privateBytes)} of private data
            comes with you.
          </p>
          {move.closesCurrentHousehold && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{move.currentHousehold?.name} will close</AlertTitle>
              <AlertDescription>You are its only member, so its shared items are deleted unless you copy them below.</AlertDescription>
            </Alert>
          )}
          {move.mustChooseNextOwner && (
            <FieldSet>
              <FieldLegend>Who owns {move.currentHousehold?.name} after you leave?</FieldLegend>
              <RadioGroup value={choices.nextOwnerUserId} onValueChange={(v) => update({ nextOwnerUserId: v as string })}>
                {move.nextOwnerCandidates.map((c) => (
                  <Field key={c.user?.id} orientation="horizontal">
                    <RadioGroupItem value={c.user?.id ?? ""} id={`owner-${c.user?.id}`} />
                    <FieldLabel htmlFor={`owner-${c.user?.id}`}>{c.user?.name}</FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
          {(items.data?.items.length ?? 0) > 0 && (
            <FieldSet>
              <FieldLegend>Copy shared items</FieldLegend>
              <FieldDescription>Copies count against the new household's storage. {move.currentHousehold?.name} keeps its own.</FieldDescription>
              {items.data?.items.map((item) => (
                <Field key={refKey(item.ref!)} orientation="horizontal">
                  <Checkbox
                    id={`copy-${refKey(item.ref!)}`}
                    checked={choices.copyItems.some((r) => refKey(r) === refKey(item.ref!))}
                    onCheckedChange={(on) => toggle(item.ref!, Boolean(on))}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={`copy-${refKey(item.ref!)}`}>{item.name}</FieldLabel>
                    <FieldDescription>
                      {appInfo(item.ref!.app)?.name}, {formatBytes(item.sizeBytes)}
                      {item.uploadedByCaller ? ", uploaded by you" : ""}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              ))}
            </FieldSet>
          )}
        </>
      )}
    </FieldGroup>
  );
}
