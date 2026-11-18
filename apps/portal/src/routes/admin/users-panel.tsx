import { useMutation, useQuery } from "@connectrpc/connect-query";
import { IamService, type User } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
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
import { BanDialog } from "./ban-dialog";

/** Find accounts and ban or unban them. Bans are permanent until lifted and carry a reason. */
export function UsersPanel() {
  const me = useViewer().data?.user?.id;
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  const users = useQuery(IamService.method.listUsers, { query });
  const [banning, setBanning] = useState<User | null>(null);
  const unban = useMutation(IamService.method.unbanUser, { onSuccess: refresh });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input aria-label="Search users" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        <FormError message={unban.error && errorMessage(unban.error)} />
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
                  {u.banned ? (
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant="destructive">Banned</Badge>
                      {u.banReason && <span className="text-xs text-muted-foreground">{u.banReason}</span>}
                    </div>
                  ) : u.isSuperAdmin ? (
                    <Badge>Server owner</Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  {u.id !== me &&
                    (u.banned ? (
                      <Button variant="outline" size="sm" onClick={() => unban.mutate({ userId: u.id })} aria-label={`Unban ${u.name}`}>
                        Unban
                      </Button>
                    ) : (
                      <Button variant="destructive" size="sm" onClick={() => setBanning(u)} aria-label={`Ban ${u.name}`}>
                        Ban
                      </Button>
                    ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {banning && <BanDialog user={banning} onClose={() => setBanning(null)} />}
    </Card>
  );
}
