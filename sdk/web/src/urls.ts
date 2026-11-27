import {
  CHUNKS_PATH,
  DOWNLOAD_QUERY_PARAM,
  DOWNLOAD_QUERY_VALUE,
  STREAM_PATH,
  TOKEN_QUERY_PARAM,
} from './constants.js'

export interface StreamUrlOptions {
  /** Read ticket for this object, from the app's API. */
  ticket?: string
  /** Ask the gateway for a Content-Disposition attachment header so browsers save the file. */
  download?: boolean
}

/** Joins a base URL and a relative path whether or not the base ends with a slash. */
export function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.endsWith('/') ? baseUrl + path : `${baseUrl}/${path}`
}

export function chunkUrl(
  baseUrl: string,
  sha256: string,
  ticket?: string,
): string {
  return withQuery(joinUrl(baseUrl, CHUNKS_PATH + sha256), { ticket })
}

export function streamUrl(
  baseUrl: string,
  objectId: string,
  ticketOrOptions?: string | StreamUrlOptions,
): string {
  const options =
    typeof ticketOrOptions === 'string'
      ? { ticket: ticketOrOptions }
      : (ticketOrOptions ?? {})
  return withQuery(
    joinUrl(baseUrl, STREAM_PATH + encodeURIComponent(objectId)),
    options,
  )
}

// Video and image elements cannot send headers, so their URLs carry the ticket instead.
function withQuery(url: string, options: StreamUrlOptions): string {
  const params: string[] = []
  if (options.ticket) {
    params.push(`${TOKEN_QUERY_PARAM}=${encodeURIComponent(options.ticket)}`)
  }
  if (options.download) {
    params.push(`${DOWNLOAD_QUERY_PARAM}=${DOWNLOAD_QUERY_VALUE}`)
  }
  return params.length > 0 ? `${url}?${params.join('&')}` : url
}
