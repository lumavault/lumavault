import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { SignUpSchema } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthCard } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/form-alert";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { publicRoute } from "@/layout/routes";
import { errorMessage } from "@/lib/session";

const SetupSchema = SignUpSchema.and(z.object({ householdName: z.string().trim().min(1, { message: "Name your household" }) }));
type SetupValues = z.infer<typeof SetupSchema>;

/** First-run setup: the server owner creates their account and first household. */
export function SetupPage() {
  const status = useQuery(IamService.method.getSetupStatus, {});
  const setup = useMutation(IamService.method.completeSetup);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<SetupValues>({
    resolver: zodResolver(SetupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "", householdName: "" },
  });

  if (status.data && !status.data.needsSetup) {
    return (
      <AuthCard title="This server is already set up" footer={<Link to="/login">Go to sign in</Link>}>
        <p className="text-sm text-muted-foreground">Ask the server owner for an invite link.</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Set up LumaVault"
      description={
        status.data?.adminEmailRequired
          ? "Create the owner account with the admin email this server was configured for."
          : "Create the owner account and your first household."
      }
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await setup.mutateAsync({ name: v.name, email: v.email, password: v.password, householdName: v.householdName });
          } catch {
            return;
          }
          queryClient.removeQueries();
          await navigate({ to: "/" });
        })}
      >
        <FieldGroup>
          <FormField control={form.control} name="name" label="Your name" autoComplete="name" />
          <FormField control={form.control} name="email" label="Email" type="email" autoComplete="email" />
          <FormField control={form.control} name="password" label="Password" type="password" autoComplete="new-password" />
          <FormField control={form.control} name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" />
          <FormField control={form.control} name="householdName" label="Household name" />
          <FormError message={setup.error && errorMessage(setup.error)} />
          <Button type="submit" disabled={setup.isPending}>
            {setup.isPending && <Spinner data-icon="inline-start" />}
            Create owner account
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}

export const route = createRoute({ getParentRoute: () => publicRoute, path: "/setup", component: SetupPage });
