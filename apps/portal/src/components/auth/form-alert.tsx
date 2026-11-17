import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function FormSuccess({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert>
      <CircleCheckIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
