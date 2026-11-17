import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChangePasswordSchema,
  type ChangePasswordValues,
  ForgotPasswordSchema,
  type ForgotPasswordValues,
  ResetPasswordSchema,
  type ResetPasswordValues,
  useChangePassword,
  useForgotPassword,
  useResetPassword,
} from "@lumavault/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { config } from "@/config";
import { FormError, FormSuccess } from "./form-alert";
import { FormField } from "./form-field";

export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(ForgotPasswordSchema), defaultValues: { email: "" } });
  return (
    <form noValidate onSubmit={form.handleSubmit(async (v) => setSent(await forgot.run(v, `${config.portalUrl}/reset-password`)))}>
      <FieldGroup>
        <FormField control={form.control} name="email" label="Email" type="email" autoComplete="email" disabled={forgot.loading} />
        <FormError message={forgot.error} />
        <FormSuccess message={sent ? "If that email has an account, a reset link is on its way." : null} />
        <Button type="submit" disabled={forgot.loading}>
          Send reset link
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ResetPasswordForm({ token, onDone }: { token: string; onDone: () => void }) {
  const reset = useResetPassword();
  const form = useForm<ResetPasswordValues>({ resolver: zodResolver(ResetPasswordSchema), defaultValues: { newPassword: "", confirmPassword: "" } });
  return (
    <form noValidate onSubmit={form.handleSubmit(async (v) => (await reset.run(v, token)) && onDone())}>
      <FieldGroup>
        <FormField control={form.control} name="newPassword" label="New password" type="password" autoComplete="new-password" disabled={reset.loading} />
        <FormField control={form.control} name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" disabled={reset.loading} />
        <FormError message={reset.error} />
        <Button type="submit" disabled={reset.loading}>
          Set new password
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ChangePasswordForm() {
  const change = useChangePassword();
  const [done, setDone] = useState(false);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        const ok = await change.run(v);
        setDone(ok);
        if (ok) form.reset();
      })}
    >
      <FieldGroup>
        <FormField control={form.control} name="currentPassword" label="Current password" type="password" autoComplete="current-password" disabled={change.loading} />
        <FormField control={form.control} name="newPassword" label="New password" type="password" autoComplete="new-password" disabled={change.loading} />
        <FormField control={form.control} name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" disabled={change.loading} />
        <FormError message={change.error} />
        <FormSuccess message={done ? "Password changed. Other devices were signed out." : null} />
        <Button type="submit" disabled={change.loading}>
          Change password
        </Button>
      </FieldGroup>
    </form>
  );
}
