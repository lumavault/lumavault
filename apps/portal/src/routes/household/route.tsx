import { useMutation, useQuery } from "@connectrpc/connect-query";
import { IamService, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { formatBytes, summarizeUsage, useActiveHousehold, useViewer } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, EllipsisIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { appRoute } from "@/layout/routes";
import { errorMessage } from "@/lib/session";

function StorageCard() {
  const viewer = useViewer();
  const { membership } = useActiveHousehold();
  const usage = viewer.data?.activeUsage;
  const cap = membership?.household?.allowance?.storageCapBytes ?? 0n;
  if (!usage) return null;
  const summary = summarizeUsage(usage.usedBytes, usage.reservedBytes, cap);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>{summary.label} used</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Progress value={summary.percent} aria-label="Storage used" />
        <p className="text-sm text-muted-foreground">
          {formatBytes(usage.usedBytes)} stored, {formatBytes(usage.reservedBytes)} reserved for uploads in progress
          {summary.overCap ? ". The household is over its limit, so new uploads are paused." : "."}
        </p>
      </CardContent>
    </Card>
  );
}

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

function InviteCard({ seatsRemaining, onChange }: { seatsRemaining: number; onChange: () => void }) {
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

/** Storage and members for the active household. Members see it read-only; Admins manage it. */
export function HouseholdPage() {
  const viewer = useViewer();
  const { membership } = useActiveHousehold();
  const members = useQuery(IamService.method.listMembers, {});
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  const setRole = useMutation(IamService.method.updateMemberRole, { onSuccess: refresh });
  const remove = useMutation(IamService.method.removeMember, { onSuccess: refresh });
  const cancel = useMutation(IamService.method.cancelMemberInvite, { onSuccess: refresh });
  const isAdmin = membership?.role === Role.ADMIN;
  const actionError = setRole.error ?? remove.error ?? cancel.error;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <StorageCard />
        {isAdmin && members.data && <InviteCard seatsRemaining={members.data.seatsRemaining} onChange={refresh} />}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{membership?.household?.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormError message={actionError && errorMessage(actionError)} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.members.map((m) => (
                <TableRow key={m.user?.id}>
                  <TableCell>
                    <div className="font-medium">{m.user?.name}</div>
                    <div className="text-xs text-muted-foreground">{m.user?.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.role === Role.ADMIN ? "default" : "secondary"}>{m.role === Role.ADMIN ? "Admin" : "Member"}</Badge>
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${m.user?.name}`} />}>
                          <EllipsisIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() =>
                                setRole.mutate({ userId: m.user?.id ?? "", role: m.role === Role.ADMIN ? Role.MEMBER : Role.ADMIN })
                              }
                            >
                              {m.role === Role.ADMIN ? "Make Member" : "Make Admin"}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate({ userId: m.user?.id ?? "" })}>
                              {m.user?.id === viewer.data?.user?.id ? "Leave household" : "Remove"}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {members.data?.pendingInvites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">Invite pending</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{i.role === Role.ADMIN ? "Admin" : "Member"}</Badge>
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => cancel.mutate({ inviteId: i.id })}>
                        Cancel
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export const route = createRoute({ getParentRoute: () => appRoute, path: "/household", component: HouseholdPage, staticData: { title: "Household" } });
