import { zodResolver } from "@hookform/resolvers/zod";
import { SignInSchema, type SignInValues, usePasskeySignIn, useSignIn } from "@lumavault/ui";
import { Link } from "@tanstack/react-router";
import { FingerprintIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "./form-alert";
import { FormField } from "./form-field";
import { useFinishSignIn } from "./return-to";

/** Email and password, plus a passkey button. Ported from the sweetbeasts-turbo login form. */
export function LoginForm() {
  const signIn = useSignIn();
  const passkey = usePasskeySignIn();
  const finish = useFinishSignIn();
  const form = useForm<SignInValues>({ resolver: zodResolver(SignInSchema), defaultValues: { email: "", password: "" } });
  const busy = signIn.loading || passkey.loading;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        if (await signIn.run(values)) await finish();
      })}
    >
      <FieldGroup>
        <FormField control={form.control} name="email" label="Email" type="email" autoComplete="email" disabled={busy} />
        <FormField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" disabled={busy} />
        <Link to="/forgot-password" className="-mt-3 self-end text-xs underline-offset-2 hover:underline">
          Forgot password?
        </Link>
        <FormError message={signIn.error ?? passkey.error} />
        <Button type="submit" disabled={busy}>
          {signIn.loading && <Spinner data-icon="inline-start" />}
          Sign in
        </Button>
        <FieldSeparator>or</FieldSeparator>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            if (await passkey.run()) await finish();
          }}
        >
          <FingerprintIcon data-icon="inline-start" />
          Sign in with a passkey
        </Button>
      </FieldGroup>
    </form>
  );
}
