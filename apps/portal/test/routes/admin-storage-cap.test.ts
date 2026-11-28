import { MAX_STORAGE_CAP_BYTES } from '@lumavault/ui/lib/format-bytes'
import {
  CAP_UNIT_BYTES,
  capBytesToDraft,
  MAX_MEMBER_LIMIT,
  parseMemberLimit,
  parseStorageCapDraft,
} from '#/routes/_portal/admin/-storage-cap'
import { describe, expect, it } from 'vitest'

describe('storage cap and member limit helpers', () => {
  it('converts storage caps to exact drafts so re-saving never shrinks them', () => {
    expect(capBytesToDraft(MAX_STORAGE_CAP_BYTES)).toEqual({
      unlimited: true,
      amount: '100',
      unit: 'GB',
    })
    expect(capBytesToDraft(2n * CAP_UNIT_BYTES.TB)).toEqual({
      unlimited: false,
      amount: '2',
      unit: 'TB',
    })
    expect(capBytesToDraft(500n * CAP_UNIT_BYTES.GB)).toEqual({
      unlimited: false,
      amount: '500',
      unit: 'GB',
    })
    expect(capBytesToDraft(1536n * CAP_UNIT_BYTES.MB)).toEqual({
      unlimited: false,
      amount: '1536',
      unit: 'MB',
    })
    expect(capBytesToDraft(1_000_000n)).toEqual({
      unlimited: false,
      amount: '1000000',
      unit: 'B',
    })
    for (const cap of [
      1536n * CAP_UNIT_BYTES.MB,
      1_000_000n,
      5n * CAP_UNIT_BYTES.GB,
    ]) {
      expect(parseStorageCapDraft(capBytesToDraft(cap))).toBe(cap)
    }
    expect(capBytesToDraft(0n)).toEqual({
      unlimited: false,
      amount: '1',
      unit: 'GB',
    })
  })

  it('parses valid storage cap drafts and rejects zero, negative, junk, or int64 overflow', () => {
    expect(
      parseStorageCapDraft({ unlimited: true, amount: '0', unit: 'GB' }),
    ).toBe(MAX_STORAGE_CAP_BYTES)
    expect(
      parseStorageCapDraft({ unlimited: false, amount: '250', unit: 'GB' }),
    ).toBe(250n * CAP_UNIT_BYTES.GB)
    expect(
      parseStorageCapDraft({ unlimited: false, amount: '4', unit: 'TB' }),
    ).toBe(4n * CAP_UNIT_BYTES.TB)

    expect(
      parseStorageCapDraft({ unlimited: false, amount: '0', unit: 'GB' }),
    ).toBeNull()
    expect(
      parseStorageCapDraft({ unlimited: false, amount: '-5', unit: 'GB' }),
    ).toBeNull()
    expect(
      parseStorageCapDraft({ unlimited: false, amount: '1.5', unit: 'TB' }),
    ).toBeNull()
    expect(
      parseStorageCapDraft({
        unlimited: false,
        amount: '9999999999',
        unit: 'TB',
      }),
    ).toBeNull()
  })

  it('validates member limits against positive int32 bounds and rejects trailing junk', () => {
    expect(parseMemberLimit('1')).toBe(1)
    expect(parseMemberLimit(' 12 ')).toBe(12)
    expect(parseMemberLimit(String(MAX_MEMBER_LIMIT))).toBe(MAX_MEMBER_LIMIT)

    expect(parseMemberLimit('0')).toBeNull()
    expect(parseMemberLimit('-1')).toBeNull()
    expect(parseMemberLimit('4abc')).toBeNull()
    expect(parseMemberLimit(String(MAX_MEMBER_LIMIT + 1))).toBeNull()
  })
})
