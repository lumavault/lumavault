import { useAddPasskey, useSignOut } from "@lumavault/ui";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { FingerprintIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { FormError, FormSuccess } from "@/components/auth/form-alert";
import { ChangePasswordForm } from "@/components/auth/password-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { appRoute } from "@/layout/routes";

export function AccountPage() {
  const addPasskey = useAddPasskey();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [deviceName, setDeviceName] = useState("");
  const [added, setAdded] = useState(false);

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>Sign in with your fingerprint, face, or device PIN instead of a password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setAdded(await addPasskey.run(deviceName.trim() || "My device"));
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="passkeyName">Name this device</FieldLabel>
                <Input id="passkeyName" placeholder="My laptop" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
              </Field>
              <FormError message={addPasskey.error} />
              <FormSuccess message={added ? "Passkey added." : null} />
              <Button type="submit" variant="outline" disabled={addPasskey.loading}>
                <FingerprintIcon data-icon="inline-start" />
                Add a passkey
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>Signs you out of every LumaVault app in this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await signOut.run()) await navigate({ to: "/login" });
            }}
          >
            <LogOutIcon data-icon="inline-start" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const route = createRoute({ getParentRoute: () => appRoute, path: "/account", component: AccountPage, staticData: { title: "Account" } });
