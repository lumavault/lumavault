import { useMutation, useQuery } from "@connectrpc/connect-query";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useViewer } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/session";

/** Find accounts and ban or unban them. A ban signs the person out everywhere at once. */
export function UsersPanel() {
  const me = useViewer().data?.user?.id;
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  const users = useQuery(IamService.method.listUsers, { query });
  const ban = useMutation(IamService.method.banUser, { onSuccess: refresh });
  const unban = useMutation(IamService.method.unbanUser, { onSuccess: refresh });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input aria-label="Search users" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        <FormError message={(ban.error ?? unban.error) && errorMessage(ban.error ?? unban.error)} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  {u.banned ? <Badge variant="destructive">Banned</Badge> : u.isSuperAdmin ? <Badge>Server owner</Badge> : null}
                </TableCell>
                <TableCell>
                  {u.id !== me &&
                    (u.banned ? (
                      <Button variant="outline" size="sm" onClick={() => unban.mutate({ userId: u.id })} aria-label={`Unban ${u.name}`}>
                        Unban
                      </Button>
                    ) : (
                      <Button variant="destructive" size="sm" onClick={() => ban.mutate({ userId: u.id })} aria-label={`Ban ${u.name}`}>
                        Ban
                      </Button>
                    ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
