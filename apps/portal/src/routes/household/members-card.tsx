import { useMutation } from "@connectrpc/connect-query";
import { IamService, type ListMembersResponse, type Member, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useHousehold, useViewer } from "@lumavault/ui";
import { EllipsisIcon } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/session";

const ROLE_LABEL: Record<number, string> = { [Role.OWNER]: "Owner", [Role.ADMIN]: "Admin", [Role.MEMBER]: "Member" };

function RoleBadge({ role, pending }: { role: Role; pending?: boolean }) {
  const variant = pending ? "outline" : role === Role.MEMBER ? "secondary" : "default";
  return <Badge variant={variant}>{ROLE_LABEL[role] ?? "Member"}</Badge>;
}

/** Members and pending invites. Admins and the Owner manage everyone except the Owner. */
export function MembersCard({ data, onChange }: { data: ListMembersResponse | undefined; onChange: () => void }) {
  const me = useViewer().data?.user?.id;
  const { household, role } = useHousehold();
  const setRole = useMutation(IamService.method.updateMemberRole, { onSuccess: onChange });
  const remove = useMutation(IamService.method.removeMember, { onSuccess: onChange });
  const transfer = useMutation(IamService.method.transferOwnership, { onSuccess: onChange });
  const cancel = useMutation(IamService.method.cancelMemberInvite, { onSuccess: onChange });
  const canManage = role === Role.OWNER || role === Role.ADMIN;
  const actionError = setRole.error ?? remove.error ?? transfer.error ?? cancel.error;
  const manageable = (m: Member) => canManage && m.role !== Role.OWNER && m.user?.id !== me;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>{household?.name}. Removed members keep read-only access to their private data for 30 days.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={actionError && errorMessage(actionError)} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.members.map((m) => (
              <TableRow key={m.user?.id}>
                <TableCell>
                  <div className="font-medium">{m.user?.name}</div>
                  <div className="text-xs text-muted-foreground">{m.user?.email}</div>
                </TableCell>
                <TableCell>
                  <RoleBadge role={m.role} />
                </TableCell>
                {canManage && (
                  <TableCell>
                    {manageable(m) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${m.user?.name}`} />}>
                          <EllipsisIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => setRole.mutate({ userId: m.user?.id ?? "", role: m.role === Role.ADMIN ? Role.MEMBER : Role.ADMIN })}
                            >
                              {m.role === Role.ADMIN ? "Make Member" : "Make Admin"}
                            </DropdownMenuItem>
                            {role === Role.OWNER && (
                              <DropdownMenuItem onClick={() => transfer.mutate({ userId: m.user?.id ?? "" })}>Make Owner</DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate({ userId: m.user?.id ?? "" })}>
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data?.pendingInvites.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <div className="font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground">Invite pending</div>
                </TableCell>
                <TableCell>
                  <RoleBadge role={i.role} pending />
                </TableCell>
                {canManage && (
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
  );
}
