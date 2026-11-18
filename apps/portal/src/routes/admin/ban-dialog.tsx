import { useMutation } from "@connectrpc/connect-query";
import { IamService, type User } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/session";

/** Bans one person permanently, with a reason the server owner can read later. */
export function BanDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ban = useMutation(IamService.method.banUser, { onSuccess: () => queryClient.invalidateQueries() });
  const [reason, setReason] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await ban.mutateAsync({ userId: user.id, reason: reason.trim() });
      onClose();
    } catch {
      // Shown below.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Ban {user.name}</DialogTitle>
            <DialogDescription>They are signed out everywhere at once and cannot sign in until you unban them.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="ban-reason">Reason</FieldLabel>
              <Textarea id="ban-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <FormError message={ban.error && errorMessage(ban.error)} />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={ban.isPending}>
              Ban
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
