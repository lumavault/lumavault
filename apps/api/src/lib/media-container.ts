// Magic-byte container detection for uploaded media files. Accepts ISO BMFF MP4 and
// QuickTime MOV headers and names common unsupported formats for error reporting.

export type SupportedMediaContainer = 'mp4' | 'mov'

export type MediaContainerDetection =
  | { ok: true; container: SupportedMediaContainer }
  | { ok: false; detectedFormat: string }

const QUICKTIME_BRAND = 'qt  '
const EBML_PREFIX = [0x1a, 0x45, 0xdf, 0xa3]
const EBML_DOCTYPE_SCAN_BYTES = 128
const MPEG_TS_SYNC_BYTE = 0x47
const MPEG_TS_PACKET_SIZE = 188

const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'mp71',
  'M4V ',
  'M4VH',
  'M4VP',
  'f4v ',
  'dash',
  'msdh',
  'msix',
  'MSNV',
  'NDAS',
  'NDSC',
  'NDSH',
  'NDSM',
  'NDSP',
  'NDSS',
  'NDXC',
  'NDXH',
  'NDXM',
  'NDXP',
  'NDXS',
])

const MP4_COMPATIBLE_BRANDS = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
])

const UNSUPPORTED_FTYP_FORMATS: Record<string, string> = {
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  heim: 'image/heic',
  heis: 'image/heic',
  hevm: 'image/heic',
  hevs: 'image/heic',
  mif1: 'image/heic',
  msf1: 'image/heic',
  avif: 'image/avif',
  avis: 'image/avif',
  'M4A ': 'audio/mp4',
  'M4B ': 'audio/mp4',
  'M4P ': 'audio/mp4',
  'f4a ': 'audio/mp4',
  'f4b ': 'audio/mp4',
  'jp2 ': 'image/jp2',
  'jpx ': 'image/jpx',
  'jpm ': 'image/jpm',
  'jxl ': 'image/jxl',
}

const ASF_GUID = [
  0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00,
  0x62, 0xce, 0x6c,
]

const PREFIX_SIGNATURES: readonly (readonly [readonly number[], string])[] = [
  [[0x46, 0x4c, 0x56, 0x01], 'video/x-flv'],
  [ASF_GUID, 'video/x-ms-asf'],
  [[0x00, 0x00, 0x01, 0xba], 'video/mpeg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x50, 0x4b, 0x03, 0x04], 'application/zip'],
]

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]!)
  }
  return out
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false
  }
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) {
      return false
    }
  }
  return true
}

function detectUnsupportedFormat(head: Uint8Array): string {
  // EBML header used by Matroska and WebM.
  if (hasPrefix(head, EBML_PREFIX)) {
    const text = asciiSlice(
      head,
      0,
      Math.min(head.length, EBML_DOCTYPE_SCAN_BYTES),
    ).toLowerCase()
    return text.includes('webm') ? 'video/webm' : 'video/x-matroska'
  }
  if (
    head.length >= 12 &&
    asciiSlice(head, 0, 4) === 'RIFF' &&
    asciiSlice(head, 8, 12) === 'AVI '
  ) {
    return 'video/x-msvideo'
  }
  if (head.length >= 4 && asciiSlice(head, 0, 4) === 'OggS') {
    return 'application/ogg'
  }
  if (
    head.length > MPEG_TS_PACKET_SIZE &&
    head[0] === MPEG_TS_SYNC_BYTE &&
    head[MPEG_TS_PACKET_SIZE] === MPEG_TS_SYNC_BYTE
  ) {
    return 'video/mp2t'
  }
  if (head.length >= 5 && asciiSlice(head, 0, 5) === '%PDF-') {
    return 'application/pdf'
  }
  for (const [prefix, format] of PREFIX_SIGNATURES) {
    if (hasPrefix(head, prefix)) {
      return format
    }
  }
  return ''
}

function parseFtypBounds(
  head: Uint8Array,
): { brandOffset: number; brandsStart: number; brandsEnd: number } | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const boxSize = view.getUint32(0, false)
  if (boxSize === 1) {
    if (head.length < 24) {
      return null
    }
    const extSize = view.getBigUint64(8, false)
    if (extSize < 24n) {
      return null
    }
    return {
      brandOffset: 16,
      brandsStart: 24,
      brandsEnd: extSize < BigInt(head.length) ? Number(extSize) : head.length,
    }
  }
  if (boxSize < 16) {
    return null
  }
  return {
    brandOffset: 8,
    brandsStart: 16,
    brandsEnd: Math.min(boxSize, head.length),
  }
}

/**
 * Inspects the leading bytes of a file to accept MP4 or QuickTime MOV via its ISO BMFF ftyp
 * box, or returns the best-effort MIME type of an unsupported format (empty when unknown).
 */
export function detectMediaContainer(
  head: Uint8Array,
): MediaContainerDetection {
  if (head.length < 16 || asciiSlice(head, 4, 8) !== 'ftyp') {
    return { ok: false, detectedFormat: detectUnsupportedFormat(head) }
  }

  const bounds = parseFtypBounds(head)
  if (!bounds) {
    return { ok: false, detectedFormat: '' }
  }

  const majorBrand = asciiSlice(
    head,
    bounds.brandOffset,
    bounds.brandOffset + 4,
  )
  if (majorBrand === QUICKTIME_BRAND) {
    return { ok: true, container: 'mov' }
  }
  const knownUnsupported = UNSUPPORTED_FTYP_FORMATS[majorBrand]
  if (knownUnsupported) {
    return { ok: false, detectedFormat: knownUnsupported }
  }
  if (majorBrand.startsWith('3gp') || majorBrand.startsWith('3g2')) {
    return { ok: false, detectedFormat: 'video/3gpp' }
  }
  if (MP4_BRANDS.has(majorBrand)) {
    return { ok: true, container: 'mp4' }
  }

  let hasQuickTime = false
  for (
    let offset = bounds.brandsStart;
    offset + 4 <= bounds.brandsEnd;
    offset += 4
  ) {
    const brand = asciiSlice(head, offset, offset + 4)
    if (MP4_COMPATIBLE_BRANDS.has(brand)) {
      return { ok: true, container: 'mp4' }
    }
    if (brand === QUICKTIME_BRAND) {
      hasQuickTime = true
    }
  }
  if (hasQuickTime) {
    return { ok: true, container: 'mov' }
  }
  return { ok: false, detectedFormat: '' }
}
