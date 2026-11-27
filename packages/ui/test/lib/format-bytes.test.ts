import {
  computeStorageSummary,
  formatBytes,
  formatStorageCap,
  isUnlimitedCap,
  MAX_STORAGE_CAP_BYTES,
} from '#lib/format-bytes'
import { describe, expect, it } from 'vitest'

describe('formatBytes', () => {
  it('formats zero and sub-kilobyte values', () => {
    expect(formatBytes(0n)).toBe('0 B')
    expect(formatBytes(512n)).toBe('512 B')
    expect(formatBytes(1023n)).toBe('1023 B')
  })

  it('formats kilobyte through terabyte values cleanly', () => {
    expect(formatBytes(1024n)).toBe('1 KB')
    expect(formatBytes(1536n)).toBe('1.5 KB')
    expect(formatBytes(4n * 1024n * 1024n)).toBe('4 MB')
    expect(formatBytes(250n * 1024n ** 3n)).toBe('250 GB')
    expect(formatBytes(2n * 1024n ** 4n)).toBe('2 TB')
  })

  it('formats 64-bit values above 9 PB without precision loss', () => {
    const tenPetabytes = 10n * 1024n ** 5n
    expect(formatBytes(tenPetabytes)).toBe('10 PB')

    const nineAndHalfPB = 9n * 1024n ** 5n + 512n * 1024n ** 4n
    expect(formatBytes(nineAndHalfPB)).toBe('9.5 PB')

    expect(formatBytes(MAX_STORAGE_CAP_BYTES)).toBe('8 EB')
  })

  it('handles negative values', () => {
    expect(formatBytes(-2048n)).toBe('-2 KB')
  })
})

describe('formatStorageCap and computeStorageSummary', () => {
  it('treats the setup maximum cap as unlimited', () => {
    expect(isUnlimitedCap(MAX_STORAGE_CAP_BYTES)).toBe(true)
    expect(formatStorageCap(MAX_STORAGE_CAP_BYTES)).toBe('Unlimited')
    expect(formatStorageCap(100n * 1024n ** 3n)).toBe('100 GB')

    const summary = computeStorageSummary(
      {
        usedBytes: 50n * 1024n ** 3n,
        reservedBytes: 10n * 1024n ** 3n,
        remainingBytes: MAX_STORAGE_CAP_BYTES - 60n * 1024n ** 3n,
      },
      MAX_STORAGE_CAP_BYTES,
    )
    expect(summary.isUnlimited).toBe(true)
    expect(summary.isOverCap).toBe(false)
    expect(summary.percentUsed).toBe(0)
  })

  it('calculates over-cap usage when the cap is lowered below current usage', () => {
    const cap = 100n * 1024n ** 3n
    const used = 120n * 1024n ** 3n
    const reserved = 5n * 1024n ** 3n

    const summary = computeStorageSummary(
      { usedBytes: used, reservedBytes: reserved, remainingBytes: 0n },
      cap,
    )
    expect(summary.isOverCap).toBe(true)
    expect(summary.overCapBytes).toBe(25n * 1024n ** 3n)
    expect(summary.percentUsed).toBe(100)
  })

  it('computes normal percentage with used and reserved combined', () => {
    const cap = 100n * 1024n ** 3n
    const summary = computeStorageSummary(
      {
        usedBytes: 40n * 1024n ** 3n,
        reservedBytes: 10n * 1024n ** 3n,
        remainingBytes: 50n * 1024n ** 3n,
      },
      cap,
    )
    expect(summary.isOverCap).toBe(false)
    expect(summary.percentUsed).toBe(50)
  })
})
