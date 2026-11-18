import { zodResolver } from "@hookform/resolvers/zod";
import { SignUpSchema, type SignUpValues, useSignUp } from "@lumavault/ui";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "./form-alert";
import { FormField } from "./form-field";

/**
 * Creates an account. Sign-up is invite-only on the server and matched by email, so the
 * email field starts with the address the invite was sent to.
 */
export function SignUpForm({ email, onDone }: { email?: string; onDone: () => void | Promise<void> }) {
  const signUp = useSignUp();
  const form = useForm<SignUpValues>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: { name: "", email: email ?? "", password: "", confirmPassword: "" },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        if (await signUp.run(values)) await onDone();
      })}
    >
      <FieldGroup>
        <FormField control={form.control} name="name" label="Name" autoComplete="name" disabled={signUp.loading} />
        <FormField control={form.control} name="email" label="Email" type="email" autoComplete="email" disabled={signUp.loading} />
        <FormField control={form.control} name="password" label="Password" type="password" autoComplete="new-password" disabled={signUp.loading} />
        <FormField control={form.control} name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" disabled={signUp.loading} />
        <FormError message={signUp.error} />
        <Button type="submit" disabled={signUp.loading}>
          {signUp.loading && <Spinner data-icon="inline-start" />}
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}
