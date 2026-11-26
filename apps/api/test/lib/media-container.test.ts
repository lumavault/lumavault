import { detectMediaContainer } from '#/lib/media-container.js'
import { describe, expect, it } from 'vitest'

function ftypBytes(
  majorBrand: string,
  compatibleBrands: string[] = [],
  minorVersion = 0,
): Uint8Array {
  const size = 16 + compatibleBrands.length * 4
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  view.setUint32(0, size, false)
  buf.set(Buffer.from('ftyp', 'ascii'), 4)
  buf.set(Buffer.from(majorBrand, 'ascii'), 8)
  view.setUint32(12, minorVersion, false)
  compatibleBrands.forEach((brand, index) => {
    buf.set(Buffer.from(brand, 'ascii'), 16 + index * 4)
  })
  return buf
}

function extendedFtypBytes(
  majorBrand: string,
  compatibleBrands: string[] = [],
): Uint8Array {
  const size = 24 + compatibleBrands.length * 4
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  view.setUint32(0, 1, false)
  buf.set(Buffer.from('ftyp', 'ascii'), 4)
  view.setBigUint64(8, BigInt(size), false)
  buf.set(Buffer.from(majorBrand, 'ascii'), 16)
  view.setUint32(20, 0, false)
  compatibleBrands.forEach((brand, index) => {
    buf.set(Buffer.from(brand, 'ascii'), 24 + index * 4)
  })
  return buf
}

function ebmlBytes(docType: string): Uint8Array {
  const docTypeBytes = Buffer.from(docType, 'ascii')
  return Uint8Array.from([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x9f,
    0x42,
    0x82,
    0x80 | docTypeBytes.length,
    ...docTypeBytes,
  ])
}

function mpegTsBytes(): Uint8Array {
  const buf = new Uint8Array(189)
  buf[0] = 0x47
  buf[188] = 0x47
  return buf
}

describe('detectMediaContainer', () => {
  it.each([
    ['isom major brand', ftypBytes('isom', ['isom', 'iso2', 'avc1', 'mp41'])],
    ['mp42 major brand', ftypBytes('mp42', ['mp42', 'isom'])],
    ['M4V major brand', ftypBytes('M4V ', ['M4V ', 'mp42'])],
    [
      'vendor major with mp42 compatible brand',
      ftypBytes('XAVC', ['XAVC', 'mp42']),
    ],
    ['64-bit extended ftyp box', extendedFtypBytes('isom', ['iso2'])],
  ])('accepts MP4 for %s', (_label, bytes) => {
    expect(detectMediaContainer(bytes)).toEqual({ ok: true, container: 'mp4' })
  })

  it.each([
    ['qt major brand', ftypBytes('qt  ', ['qt  '])],
    [
      'vendor major with qt compatible brand',
      ftypBytes('VND1', ['VND1', 'qt  ']),
    ],
    ['64-bit extended ftyp box with qt brand', extendedFtypBytes('qt  ')],
  ])('accepts MOV for %s', (_label, bytes) => {
    expect(detectMediaContainer(bytes)).toEqual({ ok: true, container: 'mov' })
  })

  it.each([
    ['HEIC ftyp', ftypBytes('heic', ['mif1', 'heic']), 'image/heic'],
    ['AVIF ftyp', ftypBytes('avif', ['mif1', 'avif']), 'image/avif'],
    ['M4A audio ftyp', ftypBytes('M4A ', ['M4A ', 'isom']), 'audio/mp4'],
    ['3GPP ftyp', ftypBytes('3gp4', ['3gp4']), 'video/3gpp'],
    ['3GPP2 ftyp', ftypBytes('3g2a', ['3g2a']), 'video/3gpp'],
    ['Matroska EBML', ebmlBytes('matroska'), 'video/x-matroska'],
    ['WebM EBML', ebmlBytes('webm'), 'video/webm'],
    ['AVI RIFF', Buffer.from('RIFF\x00\x00\x00\x00AVI '), 'video/x-msvideo'],
    ['FLV', Uint8Array.from([0x46, 0x4c, 0x56, 0x01, 0x05]), 'video/x-flv'],
    ['Ogg', Buffer.from('OggS\x00\x02'), 'application/ogg'],
    [
      'ASF',
      Uint8Array.from([
        0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa,
        0x00, 0x62, 0xce, 0x6c,
      ]),
      'video/x-ms-asf',
    ],
    ['MPEG-PS', Uint8Array.from([0x00, 0x00, 0x01, 0xba, 0x44]), 'video/mpeg'],
    ['MPEG-TS', mpegTsBytes(), 'video/mp2t'],
    [
      'PNG',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png',
    ],
    ['JPEG', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['PDF', Buffer.from('%PDF-1.7\n'), 'application/pdf'],
    ['ZIP', Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), 'application/zip'],
  ])('rejects %s with detected format %s', (_label, bytes, expectedFormat) => {
    expect(detectMediaContainer(bytes)).toEqual({
      ok: false,
      detectedFormat: expectedFormat,
    })
  })

  it('returns an empty detected format for unknown or malformed inputs', () => {
    expect(detectMediaContainer(new Uint8Array(0))).toEqual({
      ok: false,
      detectedFormat: '',
    })
    expect(
      detectMediaContainer(Uint8Array.from([0xde, 0xad, 0xbe, 0xef])),
    ).toEqual({
      ok: false,
      detectedFormat: '',
    })
    expect(detectMediaContainer(ftypBytes('XXXX', ['YYYY']))).toEqual({
      ok: false,
      detectedFormat: '',
    })

    // Malformed ftyp box with boxSize smaller than the 16-byte header.
    const smallBox = ftypBytes('isom')
    new DataView(smallBox.buffer).setUint32(0, 8, false)
    expect(detectMediaContainer(smallBox)).toEqual({
      ok: false,
      detectedFormat: '',
    })

    // Malformed extended ftyp box that is truncated before the 24-byte header ends.
    const truncatedExtended = new Uint8Array(20)
    new DataView(truncatedExtended.buffer).setUint32(0, 1, false)
    truncatedExtended.set(Buffer.from('ftyp', 'ascii'), 4)
    expect(detectMediaContainer(truncatedExtended)).toEqual({
      ok: false,
      detectedFormat: '',
    })
  })
})
