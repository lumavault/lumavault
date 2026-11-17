// Decimal units, the way people read storage on phones and in shops.
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB"] as const;
const STEP = 1000n;

/** Formats a byte count, exact for 64-bit values, with at most one decimal place. */
export function formatBytes(bytes: bigint | number): string {
  let value = typeof bytes === "bigint" ? bytes : BigInt(Math.max(0, Math.floor(bytes)));
  if (value < 0n) value = 0n;
  let unit = 0;
  let scale = 1n;
  while (unit < UNITS.length - 1 && value >= scale * STEP) {
    scale *= STEP;
    unit += 1;
  }
  if (unit === 0) return `${value} B`;
  // Tenths, rounded half up, computed in bigint so values past 2^53 stay exact.
  const tenths = (value * 10n + scale / 2n) / scale;
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return `${whole}${frac === 0n ? "" : `.${frac}`} ${UNITS[unit]}`;
}

export interface UsageSummary {
  /** Percent of the cap used or reserved, from 0 to 100. */
  percent: number;
  /** True when used plus reserved bytes exceed the cap, which happens when a cap is lowered. */
  overCap: boolean;
  label: string;
}

export function summarizeUsage(usedBytes: bigint, reservedBytes: bigint, capBytes: bigint): UsageSummary {
  const taken = usedBytes + reservedBytes;
  const overCap = taken > capBytes;
  const percent = capBytes === 0n ? (taken > 0n ? 100 : 0) : Math.min(100, Number((taken * 1000n) / capBytes) / 10);
  return { percent, overCap, label: `${formatBytes(taken)} of ${formatBytes(capBytes)}` };
}
