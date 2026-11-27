const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const
const UNIT_STEP = 1024n

// Matches SETUP_STORAGE_CAP_BYTES / MAX_STORAGE_CAP_BYTES in apps/api/src/iam/constants.ts.
export const MAX_STORAGE_CAP_BYTES = (1n << 63n) - 1n

export interface StorageUsageInput {
  usedBytes: bigint
  reservedBytes: bigint
  remainingBytes: bigint
}

export interface StorageSummary {
  usedBytes: bigint
  reservedBytes: bigint
  totalAllocatedBytes: bigint
  remainingBytes: bigint
  capBytes: bigint
  isUnlimited: boolean
  isOverCap: boolean
  overCapBytes: bigint
  percentUsed: number
}

export function isUnlimitedCap(capBytes: bigint): boolean {
  return capBytes >= MAX_STORAGE_CAP_BYTES
}

// Formats 64-bit byte counts using exact bigint division so values above 2^53 (9 PB) keep precision.
export function formatBytes(bytes: bigint): string {
  if (bytes === 0n) {
    return '0 B'
  }
  const negative = bytes < 0n
  let value = negative ? -bytes : bytes
  let unitIndex = 0
  let divisor = 1n

  while (unitIndex < BYTE_UNITS.length - 1 && value >= divisor * UNIT_STEP) {
    divisor *= UNIT_STEP
    unitIndex += 1
  }

  const prefix = negative ? '-' : ''
  const unit = BYTE_UNITS[unitIndex] ?? 'B'

  if (unitIndex === 0) {
    return `${prefix}${value.toString()} ${unit}`
  }

  const whole = value / divisor
  const remainder = value % divisor
  // Scale remainder to one decimal place (rounded to nearest tenth) using integer math.
  const scaledTenths = (remainder * 10n + divisor / 2n) / divisor
  if (scaledTenths >= 10n) {
    const bumped = whole + 1n
    if (bumped >= UNIT_STEP && unitIndex < BYTE_UNITS.length - 1) {
      return `${prefix}1 ${BYTE_UNITS[unitIndex + 1]}`
    }
    return `${prefix}${bumped.toString()} ${unit}`
  }
  if (scaledTenths === 0n) {
    return `${prefix}${whole.toString()} ${unit}`
  }
  return `${prefix}${whole.toString()}.${scaledTenths.toString()} ${unit}`
}

export function formatStorageCap(capBytes: bigint): string {
  if (isUnlimitedCap(capBytes)) {
    return 'Unlimited'
  }
  return formatBytes(capBytes)
}

export function computeStorageSummary(
  usage: StorageUsageInput,
  capBytes: bigint,
): StorageSummary {
  const totalAllocatedBytes = usage.usedBytes + usage.reservedBytes
  const isUnlimited = isUnlimitedCap(capBytes)
  const isOverCap =
    !isUnlimited && capBytes > 0n && totalAllocatedBytes > capBytes
  const overCapBytes = isOverCap ? totalAllocatedBytes - capBytes : 0n

  let percentUsed = 0
  if (!isUnlimited && capBytes > 0n) {
    const permille = (totalAllocatedBytes * 1000n) / capBytes
    const clampedPermille = permille > 1000n ? 1000n : permille
    percentUsed = Number(clampedPermille) / 10
  }

  return {
    usedBytes: usage.usedBytes,
    reservedBytes: usage.reservedBytes,
    totalAllocatedBytes,
    remainingBytes: usage.remainingBytes,
    capBytes,
    isUnlimited,
    isOverCap,
    overCapBytes,
    percentUsed,
  }
}
