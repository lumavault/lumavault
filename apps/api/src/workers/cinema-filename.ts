import type { TmdbMediaKind, TmdbSearchResult } from '#/lib/tmdb/index.js'

const MIN_RELEASE_YEAR = 1888
const MAX_YEAR_LOOKAHEAD = 2
const MIN_ARTICLE_RELAXED_LENGTH = 4

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|mkv|avi|webm)$/i
const MULTI_EPISODE_RE =
  /(?:^|[\s._\-\[(])s\d{1,2}[\s._-]*e\d{1,3}(?:[\s._-]*e\d{1,3}|-\d{1,3})(?=$|[\s._\-\])])/i
const EPISODE_PATTERNS = [
  /(?:^|[\s._\-\[(])s(\d{1,2})[\s._-]*e(\d{1,3})(?=$|[\s._\-\])])/i,
  /(?:^|[\s._\-\[(])season[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})(?=$|[\s._\-\])])/i,
  /(?:^|[\s._\-\[(])(\d{1,2})x(\d{2,3})(?=$|[\s._\-\])])/i,
] as const
const BRACKETED_YEAR_RE = /[\(\[](\d{4})[\)\]]/g
const BARE_YEAR_RE = /(?:^|[\s._-])(\d{4})(?=$|[\s._\-\)\]])/g
const RELEASE_TAG_RE =
  /(?:^|[\s._\-\[(])(?:2160p|1080p|720p|480p|3840x2160|1920x1080|1280x720|4k|uhd|hdr10\+?|hdr|bluray|blu-ray|bdrip|brrip|web-dl|webdl|webrip|hdtv|dvdrip|remux|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|eac3|ddp5(?:\.1)?|dts|atmos|truehd|10bit|proper|repack|imax)(?=$|[\s._\-\])])/i

export type ParsedMediaFilename =
  | { kind: 'movie'; title: string; year: number | null }
  | {
      kind: 'episode'
      title: string
      year: number | null
      seasonNumber: number
      episodeNumber: number
    }

function cleanTitle(raw: string): string {
  return raw
    .replace(/[._]+/g, ' ')
    .replace(/[\(\[\{]\s*[\)\]\}]/g, ' ')
    .replace(/(?:^[\s\-]+|[\s\-]+$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitleAndYear(
  raw: string,
  maxYear: number,
): { title: string; year: number | null } {
  for (const pattern of [BRACKETED_YEAR_RE, BARE_YEAR_RE]) {
    let best: { title: string; year: number } | null = null
    for (const match of raw.matchAll(pattern)) {
      const year = Number(match[1])
      if (year < MIN_RELEASE_YEAR || year > maxYear) {
        continue
      }
      const title = cleanTitle(raw.slice(0, match.index))
      if (title) {
        best = { title, year }
      }
    }
    if (best) {
      return best
    }
  }

  const tagMatch = RELEASE_TAG_RE.exec(raw)
  const truncated =
    tagMatch && cleanTitle(raw.slice(0, tagMatch.index))
      ? raw.slice(0, tagMatch.index)
      : raw
  const stripped = truncated.replace(/(?:\s*[\(\[][^\)\]]*[\)\]])+$/g, '')
  return { title: cleanTitle(stripped || truncated), year: null }
}

/**
 * Extracts a candidate movie or TV episode lookup from a media filename.
 * Returns null for ambiguous or unparseable names such as multi-episode files.
 */
export function parseMediaFilename(
  filename: string,
  now: () => number = Date.now,
): ParsedMediaFilename | null {
  const base = filename.replace(/^.*[/\\]/, '').trim()
  const stem = base.replace(VIDEO_EXT_RE, '').trim()
  if (!stem) {
    return null
  }

  const maxYear = new Date(now()).getUTCFullYear() + MAX_YEAR_LOOKAHEAD

  // Leave multi-episode files unmatched so a library manager can assign them explicitly.
  if (MULTI_EPISODE_RE.test(stem)) {
    return null
  }

  for (const pattern of EPISODE_PATTERNS) {
    const match = pattern.exec(stem)
    if (!match) {
      continue
    }
    const seasonNumber = Number(match[1])
    const episodeNumber = Number(match[2])
    if (
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 0 ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 1
    ) {
      return null
    }
    const prefix = stem.slice(0, match.index)
    const { title, year } = extractTitleAndYear(prefix, maxYear)
    if (!title) {
      return null
    }
    return { kind: 'episode', title, year, seasonNumber, episodeNumber }
  }

  const { title, year } = extractTitleAndYear(stem, maxYear)
  if (!title) {
    return null
  }
  return { kind: 'movie', title, year }
}

function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function stripLeadingArticle(normalized: string): string {
  return normalized.replace(/^(?:the|a|an)\s+/, '')
}

function singleMatch<T>(items: T[]): T | null {
  return items.length === 1 ? items[0]! : null
}

/**
 * Picks a unique high-confidence TMDB search hit for a parsed filename, or null when the
 * results are missing, weak, or ambiguous.
 */
export function pickConfidentCatalogHit(
  results: readonly TmdbSearchResult[],
  parsed: ParsedMediaFilename,
): TmdbSearchResult | null {
  const expectedKind: TmdbMediaKind =
    parsed.kind === 'movie' ? 'movie' : 'series'
  const queryNorm = normalizeTitle(parsed.title)
  if (!queryNorm) {
    return null
  }
  const queryBare = stripLeadingArticle(queryNorm)
  const candidates = results.filter((r) => r.kind === expectedKind)
  const exact = candidates.filter((r) => normalizeTitle(r.title) === queryNorm)
  const relaxed = candidates.filter(
    (r) => stripLeadingArticle(normalizeTitle(r.title)) === queryBare,
  )

  if (parsed.year !== null) {
    const exactYear = exact.filter((r) => r.releaseYear === parsed.year)
    if (exactYear.length > 0) {
      return singleMatch(exactYear)
    }
    const relaxedYear = relaxed.filter((r) => r.releaseYear === parsed.year)
    if (relaxedYear.length > 0) {
      return singleMatch(relaxedYear)
    }
    const nearYear = exact.filter(
      (r) =>
        r.releaseYear !== null && Math.abs(r.releaseYear - parsed.year!) === 1,
    )
    return singleMatch(nearYear)
  }

  if (exact.length > 0) {
    return singleMatch(exact)
  }
  if (queryBare.length >= MIN_ARTICLE_RELAXED_LENGTH) {
    return singleMatch(relaxed)
  }
  return null
}
