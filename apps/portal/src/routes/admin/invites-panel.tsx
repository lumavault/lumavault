import { useMutation, useQuery } from "@connectrpc/connect-query";
import { App, IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { formatBytes } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/session";
import { type AllowanceDraft, AllowanceFields, gbToBytes } from "./allowance-fields";

const DEFAULT_DRAFT: AllowanceDraft = { capGb: "500", apps: [App.PHOTOS, App.CINEMA, App.ARCADE], memberLimit: "4" };

/** Household creation invites. Each is for one email address and is emailed to it. */
export function InvitesPanel() {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  const invites = useQuery(IamService.method.listHouseholdInvites, {});
  const create = useMutation(IamService.method.createHouseholdInvite, { onSuccess: refresh });
  const revoke = useMutation(IamService.method.revokeHouseholdInvite, { onSuccess: refresh });
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await create.mutateAsync({
        email: email.trim(),
        note: note.trim(),
        allowance: { storageCapBytes: gbToBytes(draft.capGb), enabledApps: draft.apps, memberLimit: Number(draft.memberLimit) || 4 },
      });
      setLink(res.inviteUrl);
      setEmail("");
      setNote("");
    } catch {
      // Shown below.
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>New household invite</CardTitle>
          <CardDescription>We email the link. It works once, only for that address, and creates a household with this allowance.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-note">Note</FieldLabel>
                <Input id="invite-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="The Lovelaces" />
                <FieldDescription>Optional, to remember who it is for.</FieldDescription>
              </Field>
              <AllowanceFields draft={draft} onChange={setDraft} idPrefix="invite" />
              <FormError message={create.error && errorMessage(create.error)} />
              <Button type="submit" disabled={!email.trim() || create.isPending}>
                Create invite link
              </Button>
              {link && (
                <Field>
                  <FieldLabel htmlFor="new-invite-link">Invite link</FieldLabel>
                  <Input id="new-invite-link" readOnly value={link} />
                  <FieldDescription>We emailed it. Copy it now if you want to send it another way; it is not shown again.</FieldDescription>
                </Field>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Open invites</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>For</TableHead>
                <TableHead>Cap</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.data?.invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium">{i.email}</div>
                    {i.note && <div className="text-xs text-muted-foreground">{i.note}</div>}
                  </TableCell>
                  <TableCell>{formatBytes(i.allowance?.storageCapBytes ?? 0n)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate({ inviteId: i.id })} aria-label={`Revoke invite for ${i.email}`}>
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
