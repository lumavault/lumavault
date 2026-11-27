import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import {
  isUnlimitedCap,
  MAX_STORAGE_CAP_BYTES,
} from '@lumavault/ui/lib/format-bytes'

export type CapUnit = 'B' | 'MB' | 'GB' | 'TB'

export const CAP_UNIT_BYTES: Record<CapUnit, bigint> = {
  B: 1n,
  MB: 1024n ** 2n,
  GB: 1024n ** 3n,
  TB: 1024n ** 4n,
}

export const MAX_MEMBER_LIMIT = 2 ** 31 - 1

export const ALL_APPS: readonly App[] = [App.PHOTOS, App.CINEMA, App.ARCADE]

export interface StorageCapDraft {
  unlimited: boolean
  amount: string
  unit: CapUnit
}

export function capBytesToDraft(capBytes: bigint): StorageCapDraft {
  if (isUnlimitedCap(capBytes)) {
    return { unlimited: true, amount: '100', unit: 'GB' }
  }
  if (capBytes <= 0n) {
    return { unlimited: false, amount: '1', unit: 'GB' }
  }
  // Largest unit that divides exactly, so re-saving the draft never changes the cap.
  const unit =
    (['TB', 'GB', 'MB'] as const).find(
      (u) => capBytes % CAP_UNIT_BYTES[u] === 0n,
    ) ?? 'B'
  return {
    unlimited: false,
    amount: (capBytes / CAP_UNIT_BYTES[unit]).toString(),
    unit,
  }
}

// Parses a positive integer storage cap into exact bigint bytes without floating-point loss.
export function parseStorageCapDraft(draft: StorageCapDraft): bigint | null {
  if (draft.unlimited) {
    return MAX_STORAGE_CAP_BYTES
  }
  const trimmed = draft.amount.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const count = BigInt(trimmed)
  if (count <= 0n) {
    return null
  }
  const bytes = count * CAP_UNIT_BYTES[draft.unit]
  if (bytes > MAX_STORAGE_CAP_BYTES) {
    return null
  }
  return bytes
}

export function parseMemberLimit(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const parsed = Number(trimmed)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_MEMBER_LIMIT
  ) {
    return null
  }
  return parsed
}

export function toggleEnabledApp(
  apps: readonly App[],
  app: App,
  checked: boolean,
): App[] {
  if (checked) {
    return apps.includes(app) ? [...apps] : [...apps, app]
  }
  return apps.filter((item) => item !== app)
}

export function sameApps(a: readonly App[], b: readonly App[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  return b.every((app) => setA.has(app))
}
