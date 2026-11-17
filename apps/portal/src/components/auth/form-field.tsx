import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "./password-input";

interface FormFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  disabled?: boolean;
  /** Element id; defaults to the field name. Set it when two forms share a page. */
  id?: string;
}

/** One labeled input wired to react-hook-form, with its validation message. */
export function FormField<T extends FieldValues>({ control, name, label, type = "text", autoComplete, disabled, id }: FormFieldProps<T>) {
  const inputId = id ?? name;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
          {type === "password" ? (
            <PasswordInput id={inputId} autoComplete={autoComplete} aria-invalid={fieldState.invalid} disabled={disabled} {...field} />
          ) : (
            <Input id={inputId} type={type} autoComplete={autoComplete} aria-invalid={fieldState.invalid} disabled={disabled} {...field} />
          )}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
