import { zodResolver } from "@hookform/resolvers/zod";
import { MagicLinkSchema, type MagicLinkValues, RETURN_TO_PARAM, safeReturnUrl, useMagicLink } from "@lumavault/ui";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { config, knownOrigins } from "@/config";
import { FormError, FormSuccess } from "./form-alert";
import { FormField } from "./form-field";

/** Emails a one-time sign-in link that returns to wherever the visitor was headed. */
export function MagicLinkForm() {
  const magic = useMagicLink();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const form = useForm<MagicLinkValues>({ resolver: zodResolver(MagicLinkSchema), defaultValues: { email: "" } });
  const callback = safeReturnUrl(search[RETURN_TO_PARAM] as string | undefined, knownOrigins, `${config.portalUrl}/`);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        if (await magic.run(values, callback)) setSentTo(values.email);
      })}
    >
      <FieldGroup>
        <FormField control={form.control} name="email" id="magic-link-email" label="Email" type="email" autoComplete="email" disabled={magic.loading} />
        <FormError message={magic.error} />
        <FormSuccess message={sentTo && `Check ${sentTo} for a sign-in link.`} />
        <Button type="submit" variant="outline" disabled={magic.loading}>
          Email me a sign-in link
        </Button>
      </FieldGroup>
    </form>
  );
}
