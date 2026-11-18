import { useMutation } from "@connectrpc/connect-query";
import { IamService, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/session";

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput readOnly value={url} aria-label="Invite link" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Copy invite link"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** Invites someone by email as an Admin or Member. The Owner role only moves by transfer. */
export function InviteCard({ seatsRemaining, onChange }: { seatsRemaining: number; onChange: () => void }) {
  const invite = useMutation(IamService.method.inviteMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(Role.MEMBER);
  const [link, setLink] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await invite.mutateAsync({ email: email.trim(), role });
      setLink(res.inviteUrl);
      setEmail("");
      onChange();
    } catch {
      // Shown below from invite.error.
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>
          {seatsRemaining === 1 ? "1 seat left" : `${seatsRemaining} seats left`}. Pending invites hold a seat until they are used or cancelled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel>Role</FieldLabel>
              <ToggleGroup value={[String(role)]} onValueChange={(v: string[]) => v[0] && setRole(Number(v[0]) as Role)} variant="outline">
                <ToggleGroupItem value={String(Role.MEMBER)}>Member</ToggleGroupItem>
                <ToggleGroupItem value={String(Role.ADMIN)}>Admin</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <FormError message={invite.error && errorMessage(invite.error)} />
            <Button type="submit" disabled={!email.trim() || invite.isPending}>
              Send invite
            </Button>
            {link && (
              <Field>
                <FieldLabel>Invite link</FieldLabel>
                <CopyLink url={link} />
                <FieldDescription>We emailed this link too. It only works for that email address.</FieldDescription>
              </Field>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
