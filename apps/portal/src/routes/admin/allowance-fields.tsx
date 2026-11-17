import { App } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { APPS } from "@/lib/apps";

// Storage caps are entered in decimal gigabytes, matching how the Portal shows them.
const BYTES_PER_GB = 1_000_000_000;

export function gbToBytes(gb: string): bigint {
  const value = Number(gb);
  return Number.isFinite(value) && value > 0 ? BigInt(Math.round(value * BYTES_PER_GB)) : 0n;
}

export function bytesToGb(bytes: bigint): string {
  return String(Number(bytes) / BYTES_PER_GB);
}

export interface AllowanceDraft {
  capGb: string;
  apps: App[];
  memberLimit: string;
}

/** Storage cap, enabled apps, and member limit, shared by the invite and edit forms. */
export function AllowanceFields({ draft, onChange, idPrefix }: { draft: AllowanceDraft; onChange: (d: AllowanceDraft) => void; idPrefix: string }) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-cap`}>Storage cap (GB)</FieldLabel>
        <Input
          id={`${idPrefix}-cap`}
          type="number"
          min="0"
          step="any"
          value={draft.capGb}
          onChange={(e) => onChange({ ...draft, capGb: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>Apps</FieldLabel>
        <ToggleGroup
          multiple
          variant="outline"
          value={draft.apps.map(String)}
          onValueChange={(v: string[]) => onChange({ ...draft, apps: v.map((x) => Number(x) as App) })}
        >
          {APPS.map((a) => (
            <ToggleGroupItem key={a.key} value={String(a.wire)}>
              {a.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-limit`}>Member limit</FieldLabel>
        <Input
          id={`${idPrefix}-limit`}
          type="number"
          min="1"
          value={draft.memberLimit}
          onChange={(e) => onChange({ ...draft, memberLimit: e.target.value })}
        />
        <FieldDescription>Pending invites count toward it. A lower limit only blocks new invites.</FieldDescription>
      </Field>
    </>
  );
}
