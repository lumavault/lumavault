import { useMutation, useQuery } from "@connectrpc/connect-query";
import { type HouseholdSummary, IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { summarizeUsage } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appInfo } from "@/lib/apps";
import { errorMessage } from "@/lib/session";
import { type AllowanceDraft, AllowanceFields, bytesToGb, gbToBytes } from "./allowance-fields";

function EditAllowanceDialog({ summary, onClose }: { summary: HouseholdSummary; onClose: () => void }) {
  const h = summary.household!;
  const queryClient = useQueryClient();
  const update = useMutation(IamService.method.updateHouseholdAllowance, { onSuccess: () => queryClient.invalidateQueries() });
  const initial: AllowanceDraft = {
    capGb: bytesToGb(h.allowance?.storageCapBytes ?? 0n),
    apps: h.allowance?.enabledApps ?? [],
    memberLimit: String(h.allowance?.memberLimit ?? 4),
  };
  const [draft, setDraft] = useState(initial);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    // Only send what changed, so a stale form never overwrites another edit.
    const paths: string[] = [];
    if (draft.capGb !== initial.capGb) paths.push("storage_cap_bytes");
    if (draft.apps.join() !== initial.apps.join()) paths.push("enabled_apps");
    if (draft.memberLimit !== initial.memberLimit) paths.push("member_limit");
    if (paths.length === 0) return onClose();
    try {
      await update.mutateAsync({
        householdId: h.id,
        allowance: { storageCapBytes: gbToBytes(draft.capGb), enabledApps: draft.apps, memberLimit: Number(draft.memberLimit) },
        updateMask: { paths },
      });
      onClose();
    } catch {
      // Shown below.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Edit {h.name}</DialogTitle>
            <DialogDescription>Lowering a cap or limit below current use is allowed; it only blocks new uploads and invites.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <AllowanceFields draft={draft} onChange={setDraft} idPrefix="edit" />
            <FormError message={update.error && errorMessage(update.error)} />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HouseholdsPanel() {
  const queryClient = useQueryClient();
  const households = useQuery(IamService.method.listHouseholds, {});
  const suspend = useMutation(IamService.method.setHouseholdSuspended, { onSuccess: () => queryClient.invalidateQueries() });
  const [editing, setEditing] = useState<HouseholdSummary | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Households</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={suspend.error && errorMessage(suspend.error)} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Apps</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {households.data?.households.map((s) => {
              const h = s.household!;
              const usage = summarizeUsage(s.usage?.usedBytes ?? 0n, s.usage?.reservedBytes ?? 0n, h.allowance?.storageCapBytes ?? 0n);
              return (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>
                    {usage.label}
                    {usage.overCap && <Badge variant="destructive">Over cap</Badge>}
                  </TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {(h.allowance?.enabledApps ?? []).map((a) => (
                      <Badge key={a} variant="secondary">
                        {appInfo(a)?.name}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {s.memberCount + s.pendingInviteCount} of {h.allowance?.memberLimit}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={!h.suspended}
                      aria-label={`${h.name} active`}
                      onCheckedChange={(on) => suspend.mutate({ householdId: h.id, suspended: !on })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${h.name}`}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">Storage is shown as used plus reserved for uploads in progress.</p>
      </CardContent>
      {editing && <EditAllowanceDialog summary={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
