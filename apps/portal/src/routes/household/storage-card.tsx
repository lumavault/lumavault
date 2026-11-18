import { formatBytes, summarizeUsage, useHousehold } from "@lumavault/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

/** How much of the household's allowance is used, reserved, and held for people who left. */
export function StorageCard() {
  const { household, usage } = useHousehold();
  if (!usage) return null;
  const summary = summarizeUsage(usage.usedBytes, usage.reservedBytes, household?.allowance?.storageCapBytes ?? 0n);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>{summary.label} used</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Progress value={summary.percent} aria-label="Storage used" />
        <p className="text-sm text-muted-foreground">
          {formatBytes(usage.usedBytes)} stored, {formatBytes(usage.reservedBytes)} reserved for uploads in progress
          {summary.overCap ? ". The household is over its limit, so new uploads are paused." : "."}
        </p>
        {usage.heldBytes > 0n && (
          <p className="text-sm text-muted-foreground">
            {formatBytes(usage.heldBytes)} of that is held for people who left, until their 30 days are up.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
